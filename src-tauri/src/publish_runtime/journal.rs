//! 私有 Attempt Journal：write-once 身份与 Manifest，加上原子发布、只追加的
//! 事件批次。控制面重启后只从这些证据恢复，不维护第二份可变状态表。

use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use publish_domain::{
    ArtifactManifest, PublishAttemptView, PublishError, PublishEvent, PublishResource,
    PublishResourceLease, ReleaseAttempt,
};
use publish_runner_core::{
    recover_attempt_view, recover_delivery_envelopes, validate_manifest_provenance,
    AttemptEventLog, AttemptPersistencePort, EventSyncReport, PreparedPublishPlan, PublishRuntime,
};
use serde::{Deserialize, Serialize};

const JOURNAL_SCHEMA_VERSION: u32 = 1;
const HEADER_FILE: &str = "attempt.json";
const EVENTS_DIRECTORY: &str = "events";
static TEMP_FILE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn journal_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn journal_error(context: &str, error: impl std::fmt::Display) -> PublishError {
    PublishError::Execution(format!("{context}: {error}"))
}

#[cfg(unix)]
fn sync_parent_directory(path: &Path) -> Result<(), PublishError> {
    let Some(parent) = path.parent() else {
        return Ok(());
    };
    File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| journal_error("sync attempt journal directory", error))
}

#[cfg(not(unix))]
fn sync_parent_directory(_path: &Path) -> Result<(), PublishError> {
    Ok(())
}

fn missing_parent_directories(path: &Path) -> Result<Vec<PathBuf>, PublishError> {
    let mut missing = Vec::new();
    let mut current = path.parent();
    while let Some(directory) = current {
        match directory.try_exists() {
            Ok(true) => break,
            Ok(false) => missing.push(directory.to_path_buf()),
            Err(error) => {
                return Err(journal_error("inspect attempt journal directory", error));
            }
        }
        current = directory.parent();
    }
    missing.reverse();
    Ok(missing)
}

/// Publish a fully synced private file without ever replacing an existing path.
/// The hard link is the atomic visibility boundary; a crash can leave only an
/// ignored temporary file, never a partially visible journal record.
fn publish_private_file(
    path: &Path,
    bytes: &[u8],
    label: &str,
) -> Result<PrivateFilePublish, PublishError> {
    let sequence = TEMP_FILE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("journal");
    let entropy = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temp_path = path.with_file_name(format!(
        ".{file_name}.tmp-{}-{entropy}-{sequence}",
        std::process::id(),
    ));
    let created_directories = missing_parent_directories(&temp_path)?;
    let mut temp_file = crate::security::open_private_file(&temp_path, true, false)
        .map_err(|error| journal_error(&format!("create temporary {label}"), error))?;
    for directory in created_directories {
        crate::security::harden_private_path(&directory)
            .map_err(|error| journal_error("harden attempt journal directory", error))?;
        sync_parent_directory(&directory)?;
    }
    let write_result = (|| {
        temp_file
            .write_all(bytes)
            .map_err(|error| journal_error(&format!("write temporary {label}"), error))?;
        temp_file
            .flush()
            .map_err(|error| journal_error(&format!("flush temporary {label}"), error))?;
        temp_file
            .sync_all()
            .map_err(|error| journal_error(&format!("sync temporary {label}"), error))?;
        crate::security::harden_private_path(&temp_path)
            .map_err(|error| journal_error(&format!("harden temporary {label}"), error))
    })();
    drop(temp_file);
    if let Err(error) = write_result {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }
    let published = match fs::hard_link(&temp_path, path) {
        Ok(()) => PrivateFilePublish::Created,
        Err(error) if error.kind() == ErrorKind::AlreadyExists => PrivateFilePublish::AlreadyExists,
        Err(error) => {
            let _ = fs::remove_file(&temp_path);
            return Err(journal_error(&format!("publish {label}"), error));
        }
    };
    // 先让最终链接的目录项持久化，再清理临时链接。清理失败不回滚已提交
    // 的权威证据；遗留临时文件会被读取路径明确忽略。
    sync_parent_directory(path)?;
    if let Err(error) = fs::remove_file(&temp_path) {
        log::warn!("failed to remove committed temporary {label}: {error}");
    }
    Ok(published)
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct AttemptJournalHeader {
    schema_version: u32,
    repository_path: String,
    created_at_unix_nanos: u128,
    prepared: PreparedPublishPlan,
    attempt: ReleaseAttempt,
    lease: PublishResourceLease,
}

impl AttemptJournalHeader {
    fn validate(&self) -> Result<(), PublishError> {
        if self.schema_version != JOURNAL_SCHEMA_VERSION {
            return Err(PublishError::Execution(format!(
                "unsupported attempt journal schema {}; expected {JOURNAL_SCHEMA_VERSION}",
                self.schema_version
            )));
        }
        if self.repository_path.trim().is_empty() {
            return Err(PublishError::Execution(
                "attempt journal repository path cannot be empty".to_string(),
            ));
        }
        if self.attempt.manifest_digest.is_some() {
            return Err(PublishError::Execution(format!(
                "attempt journal header {} must precede manifest binding",
                self.attempt.attempt_id
            )));
        }
        self.lease.validate()?;
        if self.lease.owner_attempt_id != self.attempt.attempt_id {
            return Err(PublishError::Execution(format!(
                "attempt journal {} carries a lease for {}",
                self.attempt.attempt_id, self.lease.owner_attempt_id
            )));
        }
        if self.attempt.configuration_revision != self.prepared.snapshot.configuration_revision
            || self.attempt.planning_snapshot_digest != self.prepared.plan.snapshot_digest
            || self.attempt.plan_version != self.prepared.plan.version
            || self.attempt.plan_digest != self.prepared.plan.digest
            || self.attempt.execution_backend != self.prepared.plan.execution_backend
            || self.attempt.runtime_revision != self.prepared.snapshot.runtime_revision
        {
            return Err(PublishError::Execution(format!(
                "attempt journal {} does not match its sealed prepared plan",
                self.attempt.attempt_id
            )));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "record_type", rename_all = "snake_case")]
enum AttemptJournalRecord {
    Manifest {
        manifest: ArtifactManifest,
    },
    Event {
        event: PublishEvent,
    },
    LeaseUpdated {
        lease: PublishResourceLease,
    },
    LeaseReleased {
        lease_id: String,
        released_at_seconds: u64,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct AttemptJournalBatch {
    records: Vec<AttemptJournalRecord>,
}

enum PrivateFilePublish {
    Created,
    AlreadyExists,
}

#[derive(Debug)]
struct LoadedJournal {
    header: AttemptJournalHeader,
    manifest: Option<ArtifactManifest>,
    events: Vec<PublishEvent>,
    last_known_sequence: u64,
    active_lease: Option<PublishResourceLease>,
}

struct LoadedRecordState {
    manifest: Option<ArtifactManifest>,
    events: Vec<PublishEvent>,
    last_known_sequence: u64,
    active_lease: Option<PublishResourceLease>,
}

pub(super) struct LoadedAttempt {
    pub prepared: PreparedPublishPlan,
    pub view: PublishAttemptView,
    pub repository_path: String,
}

#[derive(Debug, Clone)]
pub(super) struct AttemptJournalRepository {
    root: PathBuf,
}

impl AttemptJournalRepository {
    pub(super) fn new(root: PathBuf) -> Self {
        Self { root }
    }

    pub(super) fn for_current_user() -> Result<Self, PublishError> {
        let home_dir = dirs::home_dir().ok_or_else(|| {
            PublishError::Execution(
                "cannot locate the current user home for the private publish attempt journal"
                    .to_string(),
            )
        })?;
        Ok(Self::new(
            home_dir.join(".one-publish").join("publish-attempts"),
        ))
    }

    fn attempt_dir(&self, attempt_id: &str) -> Result<PathBuf, PublishError> {
        if attempt_id.trim().is_empty() {
            return Err(PublishError::Execution(
                "attempt journal requires a non-empty attempt id".to_string(),
            ));
        }
        Ok(self
            .root
            .join(publish_domain::sha256_hex(attempt_id.as_bytes())))
    }

    fn header_path(&self, attempt_id: &str) -> Result<PathBuf, PublishError> {
        Ok(self.attempt_dir(attempt_id)?.join(HEADER_FILE))
    }

    pub(super) fn has_published_header(&self, attempt_id: &str) -> Result<bool, PublishError> {
        self.header_path(attempt_id)?
            .try_exists()
            .map_err(|error| journal_error("inspect attempt journal header", error))
    }

    fn events_directory(&self, attempt_id: &str) -> Result<PathBuf, PublishError> {
        Ok(self.attempt_dir(attempt_id)?.join(EVENTS_DIRECTORY))
    }

    fn write_header(&self, header: &AttemptJournalHeader) -> Result<(), PublishError> {
        header.validate()?;
        let path = self.header_path(&header.attempt.attempt_id)?;
        let bytes = serde_json::to_vec_pretty(header)
            .map_err(|error| journal_error("serialize attempt journal header", error))?;
        let _guard = journal_lock()
            .lock()
            .map_err(|_| journal_error("lock attempt journal", "lock is poisoned"))?;
        match publish_private_file(&path, &bytes, "attempt journal header")? {
            PrivateFilePublish::Created => Ok(()),
            PrivateFilePublish::AlreadyExists => {
                let existing = Self::read_json::<AttemptJournalHeader>(&path, "header")?;
                if existing == *header {
                    Ok(())
                } else {
                    Err(PublishError::Execution(format!(
                        "attempt journal {} already carries conflicting identity evidence",
                        header.attempt.attempt_id
                    )))
                }
            }
        }
    }

    fn read_json<T: for<'de> Deserialize<'de>>(
        path: &Path,
        label: &str,
    ) -> Result<T, PublishError> {
        let bytes = fs::read(path)
            .map_err(|error| journal_error(&format!("read attempt {label}"), error))?;
        serde_json::from_slice(&bytes)
            .map_err(|error| journal_error(&format!("decode attempt {label}"), error))
    }

    fn read_records(
        &self,
        attempt_id: &str,
        initial_lease: &PublishResourceLease,
    ) -> Result<LoadedRecordState, PublishError> {
        let directory = self.events_directory(attempt_id)?;
        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(error) if error.kind() == ErrorKind::NotFound => {
                return Ok(LoadedRecordState {
                    manifest: None,
                    events: Vec::new(),
                    last_known_sequence: 0,
                    active_lease: Some(initial_lease.clone()),
                });
            }
            Err(error) => return Err(journal_error("list attempt event journal", error)),
        };
        let mut paths = entries
            .map(|entry| {
                entry
                    .map(|entry| entry.path())
                    .map_err(|error| journal_error("read attempt event journal entry", error))
            })
            .collect::<Result<Vec<_>, _>>()?;
        paths.retain(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("batch-") && name.ends_with(".json"))
        });
        paths.sort();
        let mut manifest: Option<ArtifactManifest> = None;
        let mut events = Vec::new();
        let mut last_known_sequence = 0u64;
        let mut leases = BTreeMap::from([(initial_lease.lease_id.clone(), initial_lease.clone())]);
        let mut released_leases = BTreeSet::new();
        for path in paths {
            let bytes = fs::read(&path)
                .map_err(|error| journal_error("read attempt event batch", error))?;
            let expected_digest = path
                .file_name()
                .and_then(|name| name.to_str())
                .and_then(|name| name.strip_prefix("batch-"))
                .and_then(|name| name.strip_suffix(".json"))
                .ok_or_else(|| {
                    journal_error("validate attempt event batch", "invalid batch file name")
                })?;
            let actual_digest = publish_domain::sha256_hex(&bytes);
            if actual_digest != expected_digest {
                return Err(PublishError::Execution(format!(
                    "attempt event batch {expected_digest} failed its content digest check"
                )));
            }
            let batch = serde_json::from_slice::<AttemptJournalBatch>(&bytes)
                .map_err(|error| journal_error("decode attempt event batch", error))?;
            for record in batch.records {
                match record {
                    AttemptJournalRecord::Manifest { manifest: incoming } => {
                        incoming.validate()?;
                        match manifest.as_ref() {
                            Some(existing) if existing != &incoming => {
                                return Err(PublishError::Execution(format!(
                                    "attempt {attempt_id} carries conflicting manifest evidence"
                                )));
                            }
                            None => manifest = Some(incoming),
                            _ => {}
                        }
                    }
                    AttemptJournalRecord::Event { event } => {
                        last_known_sequence = last_known_sequence.max(event.sequence);
                        events.push(event);
                    }
                    AttemptJournalRecord::LeaseUpdated { lease } => {
                        lease.validate()?;
                        if lease.owner_attempt_id != attempt_id
                            || lease.resources != initial_lease.resources
                        {
                            return Err(PublishError::Execution(format!(
                                "attempt {attempt_id} carries a lease update with conflicting identity"
                            )));
                        }
                        match leases.get(&lease.lease_id) {
                            Some(existing)
                                if existing.acquired_at_seconds != lease.acquired_at_seconds =>
                            {
                                return Err(PublishError::Execution(format!(
                                    "attempt {attempt_id} changed lease {} acquisition evidence",
                                    lease.lease_id
                                )));
                            }
                            Some(existing)
                                if existing.expires_at_seconds >= lease.expires_at_seconds => {}
                            _ => {
                                leases.insert(lease.lease_id.clone(), lease);
                            }
                        }
                    }
                    AttemptJournalRecord::LeaseReleased { lease_id, .. } => {
                        released_leases.insert(lease_id);
                    }
                }
            }
        }
        if let Some(unknown) = released_leases
            .iter()
            .find(|lease_id| !leases.contains_key(*lease_id))
        {
            return Err(PublishError::Execution(format!(
                "attempt {attempt_id} releases unknown lease {unknown}"
            )));
        }
        let active_leases = leases
            .into_iter()
            .filter(|(lease_id, _)| !released_leases.contains(lease_id))
            .map(|(_, lease)| lease)
            .collect::<Vec<_>>();
        if active_leases.len() > 1 {
            return Err(PublishError::Execution(format!(
                "attempt {attempt_id} carries multiple active lease identities"
            )));
        }
        Ok(LoadedRecordState {
            manifest,
            events,
            last_known_sequence,
            active_lease: active_leases.into_iter().next(),
        })
    }

    fn append_records(
        &self,
        attempt_id: &str,
        records: &[AttemptJournalRecord],
    ) -> Result<(), PublishError> {
        if records.is_empty() {
            return Ok(());
        }
        let batch = AttemptJournalBatch {
            records: records.to_vec(),
        };
        let bytes = serde_json::to_vec(&batch)
            .map_err(|error| journal_error("serialize attempt event batch", error))?;
        let digest = publish_domain::sha256_hex(&bytes);
        let path = self
            .events_directory(attempt_id)?
            .join(format!("batch-{digest}.json"));
        match publish_private_file(&path, &bytes, "attempt event batch")? {
            PrivateFilePublish::Created => Ok(()),
            PrivateFilePublish::AlreadyExists => {
                let existing = fs::read(&path)
                    .map_err(|error| journal_error("read attempt event batch", error))?;
                if existing == bytes {
                    Ok(())
                } else {
                    Err(PublishError::Execution(format!(
                        "attempt event batch {digest} carries conflicting evidence"
                    )))
                }
            }
        }
    }

    fn load_journal(&self, attempt_id: &str) -> Result<LoadedJournal, PublishError> {
        let header =
            Self::read_json::<AttemptJournalHeader>(&self.header_path(attempt_id)?, "header")?;
        header.validate()?;
        if header.attempt.attempt_id != attempt_id {
            return Err(PublishError::Execution(format!(
                "attempt journal path for {attempt_id} contains {}",
                header.attempt.attempt_id
            )));
        }
        let records = self.read_records(attempt_id, &header.lease)?;
        if let Some(manifest) = records.manifest.as_ref() {
            validate_manifest_provenance(&header.prepared, manifest)?;
        }
        let mut log = AttemptEventLog::new(&header.attempt)?;
        log.sync(&records.events)?;
        Ok(LoadedJournal {
            header,
            manifest: records.manifest,
            events: log.events(),
            last_known_sequence: records.last_known_sequence,
            active_lease: records.active_lease,
        })
    }

    pub(super) fn load_attempt(&self, attempt_id: &str) -> Result<LoadedAttempt, PublishError> {
        let loaded = self.load_journal(attempt_id)?;
        let mut log = AttemptEventLog::new(&loaded.header.attempt)?;
        log.sync(&loaded.events)?;
        let missing = log.missing_ranges_through(loaded.last_known_sequence);
        if !missing.is_empty() {
            return Err(PublishError::EventSequenceGap { missing });
        }
        let mut view = recover_attempt_view(
            &loaded.header.attempt,
            &loaded.header.prepared.plan.routes,
            &loaded.events,
        )?;
        match (view.attempt.manifest_digest.as_deref(), loaded.manifest) {
            (Some(expected), Some(manifest)) if manifest.digest == expected => {
                view.manifest = Some(manifest);
            }
            (Some(_), Some(_)) => {
                return Err(PublishError::Execution(format!(
                    "attempt {attempt_id} manifest evidence conflicts with its event history"
                )));
            }
            (Some(_), None) => return Err(PublishError::MissingArtifactManifest),
            (None, Some(_)) => {
                return Err(PublishError::Execution(format!(
                    "attempt {attempt_id} has manifest evidence without a manifest binding event"
                )));
            }
            (None, None) => {}
        }
        Ok(LoadedAttempt {
            prepared: loaded.header.prepared,
            view,
            repository_path: loaded.header.repository_path,
        })
    }

    pub(super) fn find_latest_attempt(
        &self,
        repository_path: &str,
        configuration_revision_id: &str,
    ) -> Result<Option<String>, PublishError> {
        let entries = match fs::read_dir(&self.root) {
            Ok(entries) => entries,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(journal_error("list attempt journals", error)),
        };
        let mut candidates = Vec::new();
        for entry in entries {
            let entry =
                entry.map_err(|error| journal_error("read attempt journal entry", error))?;
            if !entry
                .file_type()
                .map_err(|error| journal_error("inspect attempt journal entry", error))?
                .is_dir()
            {
                continue;
            }
            let path = entry.path().join(HEADER_FILE);
            let bytes = match fs::read(&path) {
                Ok(bytes) => bytes,
                Err(error) if error.kind() == ErrorKind::NotFound => continue,
                Err(error) => return Err(journal_error("read attempt header", error)),
            };
            let header = match serde_json::from_slice::<AttemptJournalHeader>(&bytes) {
                Ok(header) => header,
                Err(error) => {
                    log::warn!(
                        "ignoring malformed publish attempt header {}: {error}",
                        path.display()
                    );
                    continue;
                }
            };
            if let Err(error) = header.validate() {
                log::warn!(
                    "ignoring invalid publish attempt header {}: {error}",
                    path.display()
                );
                continue;
            }
            if header.repository_path != repository_path
                || header.attempt.configuration_revision != configuration_revision_id
            {
                continue;
            }
            candidates.push((header.created_at_unix_nanos, header.attempt.attempt_id));
        }
        candidates.sort_by(|left, right| right.cmp(left));
        let mut latest_terminal = None;
        for (_, attempt_id) in candidates {
            match self.load_attempt(&attempt_id) {
                Ok(loaded)
                    if loaded.view.status == publish_domain::PublishAttemptStatus::Running =>
                {
                    return Ok(Some(attempt_id));
                }
                Ok(_) if latest_terminal.is_none() => latest_terminal = Some(attempt_id),
                Ok(_) => {}
                Err(error) => {
                    log::warn!(
                        "ignoring unrecoverable publish attempt journal {attempt_id}: {error}"
                    );
                }
            }
        }
        Ok(latest_terminal)
    }

    pub(super) fn attempt_scope(&self, attempt_id: &str) -> Result<(String, String), PublishError> {
        let header =
            Self::read_json::<AttemptJournalHeader>(&self.header_path(attempt_id)?, "header")?;
        header.validate()?;
        if header.attempt.attempt_id != attempt_id {
            return Err(PublishError::Execution(format!(
                "attempt journal path for {attempt_id} contains {}",
                header.attempt.attempt_id
            )));
        }
        Ok((
            header.repository_path,
            header.attempt.configuration_revision,
        ))
    }

    pub(super) fn active_lease(
        &self,
        attempt_id: &str,
        now_seconds: u64,
    ) -> Result<Option<PublishResourceLease>, PublishError> {
        Ok(self
            .load_journal(attempt_id)?
            .active_lease
            .filter(|lease| !lease.is_expired(now_seconds)))
    }

    pub(super) fn active_leases(
        &self,
        now_seconds: u64,
        relevant_resources: &BTreeSet<PublishResource>,
    ) -> Result<Vec<PublishResourceLease>, PublishError> {
        let entries = match fs::read_dir(&self.root) {
            Ok(entries) => entries,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(journal_error("list attempt journals", error)),
        };
        let mut leases = Vec::new();
        for entry in entries {
            let entry =
                entry.map_err(|error| journal_error("read attempt journal entry", error))?;
            if !entry
                .file_type()
                .map_err(|error| journal_error("inspect attempt journal entry", error))?
                .is_dir()
            {
                continue;
            }
            let path = entry.path().join(HEADER_FILE);
            let bytes = match fs::read(&path) {
                Ok(bytes) => bytes,
                Err(error) if error.kind() == ErrorKind::NotFound => continue,
                Err(error) => return Err(journal_error("read attempt header", error)),
            };
            let header = match serde_json::from_slice::<AttemptJournalHeader>(&bytes) {
                Ok(header) => header,
                Err(error) => {
                    log::warn!(
                        "ignoring malformed publish lease header {}: {error}",
                        path.display()
                    );
                    continue;
                }
            };
            if let Err(error) = header.validate() {
                log::warn!(
                    "ignoring invalid publish lease header {}: {error}",
                    path.display()
                );
                continue;
            }
            if header.lease.resources.is_disjoint(relevant_resources) {
                continue;
            }
            let loaded = self.load_journal(&header.attempt.attempt_id)?;
            let view = recover_attempt_view(
                &loaded.header.attempt,
                &loaded.header.prepared.plan.routes,
                &loaded.events,
            )?;
            if view.status != publish_domain::PublishAttemptStatus::Running {
                if let Some(lease) = loaded.active_lease {
                    self.release_lease(&header.attempt.attempt_id, &lease.lease_id, now_seconds)?;
                }
                continue;
            }
            if let Some(lease) = loaded
                .active_lease
                .filter(|lease| !lease.is_expired(now_seconds))
            {
                leases.push(lease);
            }
        }
        Ok(leases)
    }

    pub(super) fn update_lease(
        &self,
        attempt_id: &str,
        lease: &PublishResourceLease,
        now_seconds: u64,
    ) -> Result<(), PublishError> {
        lease.validate()?;
        if lease.owner_attempt_id != attempt_id {
            return Err(PublishError::Execution(format!(
                "attempt {attempt_id} cannot persist lease for {}",
                lease.owner_attempt_id
            )));
        }
        let _guard = journal_lock()
            .lock()
            .map_err(|_| journal_error("lock attempt journal", "lock is poisoned"))?;
        let loaded = self.load_journal(attempt_id)?;
        if lease.resources != loaded.header.lease.resources {
            return Err(PublishError::Execution(format!(
                "attempt {attempt_id} cannot change its leased resources"
            )));
        }
        let mut records = Vec::new();
        match loaded.active_lease {
            Some(existing) if existing.lease_id != lease.lease_id => {
                if !existing.is_expired(now_seconds) {
                    return Err(PublishError::Execution(format!(
                        "attempt {attempt_id} already holds another active lease"
                    )));
                }
                records.push(AttemptJournalRecord::LeaseReleased {
                    lease_id: existing.lease_id,
                    released_at_seconds: now_seconds,
                });
            }
            Some(existing) if existing.expires_at_seconds >= lease.expires_at_seconds => {
                return Ok(());
            }
            _ => {}
        }
        records.push(AttemptJournalRecord::LeaseUpdated {
            lease: lease.clone(),
        });
        self.append_records(attempt_id, &records)
    }

    pub(super) fn release_lease(
        &self,
        attempt_id: &str,
        lease_id: &str,
        released_at_seconds: u64,
    ) -> Result<bool, PublishError> {
        let _guard = journal_lock()
            .lock()
            .map_err(|_| journal_error("lock attempt journal", "lock is poisoned"))?;
        let loaded = self.load_journal(attempt_id)?;
        let Some(active) = loaded.active_lease else {
            return Ok(false);
        };
        if active.lease_id != lease_id {
            return Err(PublishError::Execution(format!(
                "attempt {attempt_id} cannot release inactive lease {lease_id}"
            )));
        }
        self.append_records(
            attempt_id,
            &[AttemptJournalRecord::LeaseReleased {
                lease_id: lease_id.to_string(),
                released_at_seconds,
            }],
        )?;
        Ok(true)
    }

    fn append_local_events(
        &self,
        attempt_id: &str,
        events: Vec<PublishEvent>,
        manifest: Option<&ArtifactManifest>,
    ) -> Result<(), PublishError> {
        if events.is_empty() {
            return Err(PublishError::Execution(
                "attempt persistence cannot append an empty event batch".to_string(),
            ));
        }
        let _guard = journal_lock()
            .lock()
            .map_err(|_| journal_error("lock attempt journal", "lock is poisoned"))?;
        let loaded = self.load_journal(attempt_id)?;
        let mut log = AttemptEventLog::new(&loaded.header.attempt)?;
        log.sync(&loaded.events)?;
        let expected = log.events().last().map_or(1, |event| event.sequence + 1);
        if events[0].sequence > expected {
            return Err(PublishError::EventSequenceGap {
                missing: vec![(expected, events[0].sequence - 1)],
            });
        }
        let events = events
            .into_iter()
            .map(sanitize_event)
            .collect::<Result<Vec<_>, _>>()?;
        if let Some(manifest) = manifest {
            validate_manifest_provenance(&loaded.header.prepared, manifest)?;
            if !events.iter().any(|event| {
                event
                    .payload
                    .get("manifest_digest")
                    .and_then(serde_json::Value::as_str)
                    == Some(manifest.digest.as_str())
            }) {
                return Err(PublishError::Execution(format!(
                    "attempt {attempt_id} manifest commit is not bound by its event batch"
                )));
            }
            if loaded
                .manifest
                .as_ref()
                .is_some_and(|existing| existing != manifest)
            {
                return Err(PublishError::Execution(format!(
                    "attempt {attempt_id} is already bound to a different artifact manifest"
                )));
            }
        }
        let existing_sequences = loaded
            .events
            .iter()
            .map(|event| event.sequence)
            .collect::<BTreeSet<_>>();
        let report = log.sync(&events)?;
        if report.accepted > 0 {
            let projection = log.reduce(&loaded.header.prepared.plan.routes)?;
            if let Some(digest) = projection.manifest_digest.as_deref() {
                let effective_manifest = manifest
                    .or(loaded.manifest.as_ref())
                    .ok_or(PublishError::MissingArtifactManifest)?;
                if effective_manifest.digest != digest {
                    return Err(PublishError::Execution(format!(
                        "attempt {attempt_id} manifest evidence conflicts with its event batch"
                    )));
                }
                recover_delivery_envelopes(
                    &log.events(),
                    &loaded.header.prepared.plan,
                    &effective_manifest.digest,
                )?;
            }
            let mut records = Vec::with_capacity(report.accepted + usize::from(manifest.is_some()));
            if loaded.manifest.is_none() {
                if let Some(manifest) = manifest {
                    records.push(AttemptJournalRecord::Manifest {
                        manifest: manifest.clone(),
                    });
                }
            }
            records.extend(
                events
                    .into_iter()
                    .filter(|event| !existing_sequences.contains(&event.sequence))
                    .map(|event| AttemptJournalRecord::Event { event }),
            );
            self.append_records(attempt_id, &records)?;
        }
        Ok(())
    }

    pub(super) fn synchronize(
        &self,
        runtime: &PublishRuntime,
        attempt_id: &str,
        incoming: Vec<PublishEvent>,
        incoming_manifest: Option<ArtifactManifest>,
        last_known_sequence: Option<u64>,
    ) -> Result<EventSyncReport, PublishError> {
        let _guard = journal_lock()
            .lock()
            .map_err(|_| journal_error("lock attempt journal", "lock is poisoned"))?;
        let loaded = self.load_journal(attempt_id)?;
        if let Some(manifest) = incoming_manifest.as_ref() {
            validate_manifest_provenance(&loaded.header.prepared, manifest)?;
            if loaded
                .manifest
                .as_ref()
                .is_some_and(|existing| existing != manifest)
            {
                return Err(PublishError::Execution(format!(
                    "attempt {attempt_id} is already bound to a different artifact manifest"
                )));
            }
        }
        let existing_sequences = loaded
            .events
            .iter()
            .map(|event| event.sequence)
            .collect::<BTreeSet<_>>();
        let incoming = incoming
            .into_iter()
            .map(sanitize_event)
            .collect::<Result<Vec<_>, _>>()?;
        let incoming_high_water = incoming
            .iter()
            .map(|event| event.sequence)
            .max()
            .unwrap_or(0);
        let high_water = loaded
            .last_known_sequence
            .max(incoming_high_water)
            .max(last_known_sequence.unwrap_or(0));
        let synchronized = runtime.synchronize_attempt(
            &loaded.header.prepared,
            &loaded.header.attempt,
            &loaded.events,
            &incoming,
            Some(high_water),
        )?;
        let report = synchronized.report;
        let missing = report.missing.clone();
        let mut records = Vec::new();
        let accepted = if missing.is_empty() {
            // 完整连续历史必须先通过 Receipt/Route/Manifest 语义归约，再成为
            // append-only 权威证据。带缺口的未来事件由调用方补拉时重送，
            // 不保留候选事件，避免畸形批次永久毒化 Journal。
            let synchronized_view = synchronized.view.as_ref().ok_or_else(|| {
                PublishError::Execution(
                    "complete synchronized event history has no recovered attempt view".to_string(),
                )
            })?;
            let synchronized_events = synchronized.events;
            let effective_manifest = match (
                synchronized_view.attempt.manifest_digest.as_deref(),
                loaded.manifest.as_ref(),
                incoming_manifest.as_ref(),
            ) {
                (Some(expected), Some(existing), _) if existing.digest == expected => {
                    Some(existing)
                }
                (Some(expected), None, Some(manifest)) if manifest.digest == expected => {
                    records.push(AttemptJournalRecord::Manifest {
                        manifest: manifest.clone(),
                    });
                    Some(manifest)
                }
                (Some(_), None, Some(_)) => {
                    return Err(PublishError::Execution(format!(
                        "attempt {attempt_id} manifest evidence conflicts with its binding event"
                    )));
                }
                (Some(_), Some(_), _) => {
                    return Err(PublishError::Execution(format!(
                        "attempt {attempt_id} manifest evidence conflicts with its event history"
                    )));
                }
                (Some(_), None, None) => return Err(PublishError::MissingArtifactManifest),
                (None, None, None) => None,
                (None, _, Some(_)) | (None, Some(_), None) => {
                    return Err(PublishError::Execution(format!(
                        "attempt {attempt_id} has manifest evidence without a binding event"
                    )));
                }
            };
            if let Some(manifest) = effective_manifest {
                recover_delivery_envelopes(
                    &synchronized_events,
                    &loaded.header.prepared.plan,
                    &manifest.digest,
                )?;
                runtime.validate_synchronized_delivery_envelopes(
                    &synchronized_events,
                    &loaded.header.prepared,
                    &loaded.header.attempt,
                    manifest,
                )?;
            } else if synchronized_events
                .iter()
                .any(|event| event.payload.contains_key("delivery_envelopes"))
            {
                return Err(PublishError::MissingArtifactManifest);
            }
            records.extend(
                synchronized_events
                    .into_iter()
                    .filter(|event| !existing_sequences.contains(&event.sequence))
                    .map(|event| AttemptJournalRecord::Event { event }),
            );
            report.accepted
        } else {
            0
        };
        self.append_records(attempt_id, &records)?;
        Ok(EventSyncReport {
            accepted,
            duplicates: report.duplicates,
            missing,
        })
    }
}

fn reject_sensitive_envelope_keys(value: &serde_json::Value) -> Result<(), PublishError> {
    match value {
        serde_json::Value::Array(values) => {
            for value in values {
                reject_sensitive_envelope_keys(value)?;
            }
        }
        serde_json::Value::Object(values) => {
            for (key, value) in values {
                let normalized = key
                    .chars()
                    .filter(|ch| ch.is_ascii_alphanumeric())
                    .map(|ch| ch.to_ascii_lowercase())
                    .collect::<String>();
                if crate::security::is_sensitive_key(key)
                    || normalized == "auth"
                    || normalized.contains("authorization")
                    || normalized.contains("cookie")
                    || normalized.contains("credential")
                    || normalized.contains("session")
                    || normalized.contains("bearer")
                {
                    return Err(PublishError::Execution(format!(
                        "delivery envelope evidence cannot persist sensitive key {key}"
                    )));
                }
                reject_sensitive_envelope_keys(value)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn sanitize_event(mut event: PublishEvent) -> Result<PublishEvent, PublishError> {
    // Delivery Envelope is executable recovery evidence: absolute target paths and
    // destination-native locators must round-trip exactly. Credentials are forbidden
    // structurally instead of mutating this evidence with the presentation redactor.
    let envelope_evidence = event.payload.remove("delivery_envelopes");
    if let Some(value) = envelope_evidence.as_ref() {
        reject_sensitive_envelope_keys(value)?;
    }
    crate::security::sanitize_json_map(&mut event.payload);
    if let Some(value) = envelope_evidence {
        event
            .payload
            .insert("delivery_envelopes".to_string(), value);
    }
    Ok(event)
}

pub(super) struct AttemptJournalPersistence {
    repository: AttemptJournalRepository,
    prepared: PreparedPublishPlan,
    repository_path: String,
    created_at_unix_nanos: u128,
    lease: Option<PublishResourceLease>,
    attempt_id: Mutex<Option<String>>,
}

impl AttemptJournalPersistence {
    pub(super) fn new(
        repository: AttemptJournalRepository,
        prepared: PreparedPublishPlan,
        repository_path: String,
        created_at_unix_nanos: u128,
        lease: PublishResourceLease,
    ) -> Self {
        Self {
            repository,
            prepared,
            repository_path,
            created_at_unix_nanos,
            lease: Some(lease),
            attempt_id: Mutex::new(None),
        }
    }

    pub(super) fn for_existing(
        repository: AttemptJournalRepository,
        prepared: PreparedPublishPlan,
        repository_path: String,
        attempt_id: String,
    ) -> Self {
        Self {
            repository,
            prepared,
            repository_path,
            created_at_unix_nanos: 0,
            lease: None,
            attempt_id: Mutex::new(Some(attempt_id)),
        }
    }

    fn attempt_id(&self) -> Result<String, PublishError> {
        self.attempt_id
            .lock()
            .map_err(|_| journal_error("lock attempt persistence", "lock is poisoned"))?
            .clone()
            .ok_or_else(|| {
                PublishError::Execution(
                    "attempt persistence was used before its write-once header".to_string(),
                )
            })
    }
}

impl AttemptPersistencePort for AttemptJournalPersistence {
    fn begin_attempt(&self, attempt: &ReleaseAttempt) -> Result<(), PublishError> {
        let lease = self.lease.clone().ok_or_else(|| {
            PublishError::Execution(
                "new attempt persistence requires its acquired resource lease".to_string(),
            )
        })?;
        let header = AttemptJournalHeader {
            schema_version: JOURNAL_SCHEMA_VERSION,
            repository_path: self.repository_path.clone(),
            created_at_unix_nanos: self.created_at_unix_nanos,
            prepared: self.prepared.clone(),
            attempt: attempt.clone(),
            lease,
        };
        self.repository.write_header(&header)?;
        let mut attempt_id = self
            .attempt_id
            .lock()
            .map_err(|_| journal_error("lock attempt persistence", "lock is poisoned"))?;
        match attempt_id.as_deref() {
            Some(existing) if existing != attempt.attempt_id => {
                return Err(PublishError::Execution(
                    "one persistence port cannot own multiple publish attempts".to_string(),
                ));
            }
            _ => *attempt_id = Some(attempt.attempt_id.clone()),
        }
        Ok(())
    }

    fn append_events(
        &self,
        events: &[PublishEvent],
        manifest: Option<&ArtifactManifest>,
    ) -> Result<(), PublishError> {
        let attempt_id = self.attempt_id()?;
        if let Some(event) = events.iter().find(|event| event.attempt_id != attempt_id) {
            return Err(PublishError::Execution(format!(
                "attempt persistence for {attempt_id} rejected event {} for {}",
                event.event_id, event.attempt_id
            )));
        }
        self.repository
            .append_local_events(&attempt_id, events.to_vec(), manifest)
    }
}

#[cfg(test)]
mod tests {
    use super::AttemptJournalRepository;

    #[test]
    fn discovery_ignores_a_crash_leftover_without_a_published_header() {
        let journal = tempfile::tempdir().expect("create attempt journal");
        let orphan = journal.path().join("orphan-attempt");
        std::fs::create_dir_all(&orphan).expect("create orphan attempt directory");
        std::fs::write(orphan.join(".attempt.json.tmp-crash"), b"incomplete")
            .expect("write crash leftover");

        let repository = AttemptJournalRepository::new(journal.path().to_path_buf());
        assert_eq!(
            repository
                .find_latest_attempt("/workspace/repository", "revision-A")
                .expect("ignore unpublished header"),
            None
        );
    }
}
