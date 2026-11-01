//! 分片产物暂存层（决议 #85）：build 段候选落盘为"字节文件 + 清单"，经
//! 外壳 artifacts 暂存交接（tar 保执行位、含 run_attempt 唯一命名），汇聚
//! 段执行前导入。Artifact Store 抽象不变：导入候选重算内容摘要，Manifest
//! 密封仍以内容为准。
//!
//! build 段的事件段同经外壳下载交给汇聚段，作为被依赖节点已在别处完成的
//! 证据；证据校验（同一 attempt 与计划、段内序号、去重）在 runner-core。

use std::path::{Path, PathBuf};

use publish_domain::{ArtifactCandidate, PublishError, PublishEvent};
use publish_runner_core::ShardOutcome;
use serde::{Deserialize, Serialize};

/// 暂存根（相对 checkout 的确定性路径，与其它 runner 运行时目录同族）。
pub const SHARD_STAGING_DIRECTORY: &str = ".one-publish-work/staged";

/// 事件段下载根：download-artifact 按 artifact 名各建一层子目录。
pub const SHARD_SEGMENTS_DIRECTORY: &str = ".one-publish-work/segments";

#[derive(Serialize, Deserialize)]
struct StagedCandidateRecord {
    role: String,
    file_name: String,
    media_type: String,
    platform: String,
    architecture: String,
    path: String,
    #[serde(default)]
    executable: bool,
}

fn staging_io_error(operation: String, error: impl std::fmt::Display) -> PublishError {
    PublishError::Io {
        operation,
        message: error.to_string(),
    }
}

/// 把本段候选写进 `<root>/<affinity>/`：字节文件按序号消歧，清单记录元数据。
pub fn stage_shard_artifacts(
    root: &Path,
    affinity: &str,
    artifacts: &[ArtifactCandidate],
) -> Result<(), PublishError> {
    let segment_root = root.join(affinity);
    let files_root = segment_root.join("files");
    std::fs::create_dir_all(&files_root)
        .map_err(|error| staging_io_error(format!("create staging {affinity}"), error))?;
    let mut records = Vec::with_capacity(artifacts.len());
    for (index, artifact) in artifacts.iter().enumerate() {
        // 候选 file_name 可含产物子目录（如 "dmg/app.dmg"）：写侧与读侧
        // 使用同一路径安全校验，落盘前物化父目录。
        if !publish_domain::is_safe_portable_relative_path(&artifact.file_name) {
            return Err(PublishError::Execution(format!(
                "staged candidate file name {} is not portable",
                artifact.file_name
            )));
        }
        let relative = format!("files/{index}-{}", artifact.file_name);
        let absolute = segment_root.join(&relative);
        if let Some(parent) = absolute.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                staging_io_error(format!("create staging parent for {relative}"), error)
            })?;
        }
        std::fs::write(&absolute, &artifact.bytes)
            .map_err(|error| staging_io_error(format!("stage {}", artifact.file_name), error))?;
        records.push(StagedCandidateRecord {
            role: artifact.role.clone(),
            file_name: artifact.file_name.clone(),
            media_type: artifact.media_type.clone(),
            platform: artifact.platform.clone(),
            architecture: artifact.architecture.clone(),
            path: relative,
            executable: artifact.executable,
        });
    }
    let manifest = serde_json::to_vec_pretty(&records)
        .map_err(|error| staging_io_error(format!("encode staging manifest {affinity}"), error))?;
    std::fs::write(segment_root.join("candidates.json"), manifest)
        .map_err(|error| staging_io_error(format!("write staging manifest {affinity}"), error))?;
    Ok(())
}

/// 读回全部段的暂存候选（按亲和目录名与清单序稳定排序）；字节重新读取，
/// 候选摘要由 `ArtifactCandidate::new` 重算——内容是唯一事实。
pub fn load_staged_artifacts(root: &Path) -> Result<Vec<ArtifactCandidate>, PublishError> {
    if !root.is_dir() {
        return Ok(Vec::new());
    }
    let mut segments: Vec<PathBuf> = std::fs::read_dir(root)
        .map_err(|error| staging_io_error(format!("read staging root {}", root.display()), error))?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            // file_type 不跟随符号链接：链接出的"段目录"一律不算暂存证据，
            // 防止损坏/替换的归档把根外内容折进候选摘要。
            entry.file_type().ok()?.is_dir().then(|| entry.path())
        })
        .collect();
    segments.sort();
    let mut artifacts = Vec::new();
    for segment in segments {
        let manifest_path = segment.join("candidates.json");
        if !manifest_path.is_file() {
            continue;
        }
        let manifest = std::fs::read(&manifest_path).map_err(|error| {
            staging_io_error(
                format!("read staging manifest {}", segment.display()),
                error,
            )
        })?;
        let records: Vec<StagedCandidateRecord> =
            serde_json::from_slice(&manifest).map_err(|error| {
                staging_io_error(
                    format!("decode staging manifest {}", manifest_path.display()),
                    error,
                )
            })?;
        for record in records {
            if !publish_domain::is_safe_portable_relative_path(&record.path) {
                return Err(PublishError::Execution(format!(
                    "staged candidate path {} is not portable",
                    record.path
                )));
            }
            let candidate_path = segment.join(&record.path);
            // 词法路径校验拦不住指向外部的符号链接：落盘字节必须来自真实
            // 常规文件，链接一律拒绝而不是跟随。
            let metadata = std::fs::symlink_metadata(&candidate_path).map_err(|error| {
                staging_io_error(format!("inspect staged candidate {}", record.path), error)
            })?;
            if metadata.file_type().is_symlink() {
                return Err(PublishError::Execution(format!(
                    "staged candidate {} is a symlink, not stored bytes",
                    record.path
                )));
            }
            let bytes = std::fs::read(&candidate_path).map_err(|error| {
                staging_io_error(format!("read staged candidate {}", record.path), error)
            })?;
            artifacts.push(
                ArtifactCandidate::new(
                    record.role,
                    record.file_name,
                    record.media_type,
                    record.platform,
                    record.architecture,
                    bytes,
                )
                .with_executable(record.executable),
            );
        }
    }
    Ok(artifacts)
}

/// 读回根下全部 `*.json` 事件段（按路径稳定排序、逐段保持段内顺序）；
/// 缺根即无证据。无法解码的段（如失败 job 留下的空文件）显式报错。
pub fn load_shard_segments(root: &Path) -> Result<Vec<PublishEvent>, PublishError> {
    let mut files = Vec::new();
    collect_segment_files(root, &mut files)?;
    files.sort();
    let mut events = Vec::new();
    for file in files {
        let bytes = std::fs::read(&file).map_err(|error| {
            staging_io_error(format!("read shard segment {}", file.display()), error)
        })?;
        let segment: ShardOutcome = serde_json::from_slice(&bytes).map_err(|error| {
            staging_io_error(format!("decode shard segment {}", file.display()), error)
        })?;
        events.extend(segment.events);
    }
    Ok(events)
}

fn collect_segment_files(directory: &Path, files: &mut Vec<PathBuf>) -> Result<(), PublishError> {
    if !directory.is_dir() {
        return Ok(());
    }
    let read_error = |error: std::io::Error| {
        staging_io_error(
            format!("read segment directory {}", directory.display()),
            error,
        )
    };
    for entry in std::fs::read_dir(directory).map_err(read_error)? {
        let entry = entry.map_err(read_error)?;
        let file_type = entry.file_type().map_err(read_error)?;
        // 符号链接不进证据树：链接目录会造成递归环或把根外 JSON 读作段；
        // file_type 取链接自身类型，真目录/真文件才继续。
        if file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        if file_type.is_dir() {
            collect_segment_files(&path, files)?;
        } else if path
            .extension()
            .is_some_and(|extension| extension == "json")
        {
            files.push(path);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nested_candidate_file_names_stage_and_load_round_trip() {
        // 复现：tauri 收集的候选 file_name 形如 "dmg/app.dmg"（bundle 子目录），
        // 落盘必须建父目录，读侧路径校验对称。
        let temp = tempfile::tempdir().expect("staging root");
        let nested = ArtifactCandidate::new(
            "installer",
            "dmg/app.dmg",
            "application/octet-stream",
            "macos",
            "aarch64",
            b"nested bytes".to_vec(),
        );
        stage_shard_artifacts(temp.path(), "macos", std::slice::from_ref(&nested))
            .expect("stage a nested candidate");
        assert_eq!(
            load_staged_artifacts(temp.path()).expect("load nested candidate"),
            vec![nested]
        );

        let escaping = ArtifactCandidate::new(
            "installer",
            "../escape.dmg",
            "application/octet-stream",
            "macos",
            "aarch64",
            b"escape".to_vec(),
        );
        stage_shard_artifacts(temp.path(), "macos", std::slice::from_ref(&escaping))
            .expect_err("path-escaping file names must be rejected at stage time");
    }

    #[test]
    fn staged_candidates_round_trip_across_segments_with_recomputed_digests() {
        let temp = tempfile::tempdir().expect("staging root");
        let linux = ArtifactCandidate::new(
            "installer",
            "app.AppImage",
            "application/octet-stream",
            "linux",
            "x86_64",
            b"linux bytes".to_vec(),
        )
        .with_executable(true);
        let macos = ArtifactCandidate::new(
            "installer",
            "app.dmg",
            "application/octet-stream",
            "macos",
            "aarch64",
            b"macos bytes".to_vec(),
        );
        stage_shard_artifacts(temp.path(), "linux", std::slice::from_ref(&linux))
            .expect("stage the linux segment");
        stage_shard_artifacts(temp.path(), "macos", std::slice::from_ref(&macos))
            .expect("stage the macos segment");

        let loaded = load_staged_artifacts(temp.path()).expect("load staged candidates");
        assert_eq!(loaded, vec![linux, macos]);

        assert!(load_staged_artifacts(&temp.path().join("missing"))
            .expect("a missing staging root is an empty set")
            .is_empty());
    }

    #[test]
    fn shard_segments_load_from_artifact_subdirectories_and_reject_empty_files() {
        let temp = tempfile::tempdir().expect("segments root");
        assert!(load_shard_segments(temp.path())
            .expect("a root without segments carries no evidence")
            .is_empty());

        // 失败 job 的 `> one-publish-events-*.json` 重定向会留下空文件。
        let artifact = temp.path().join("one-publish-events-1-1-linux");
        std::fs::create_dir_all(&artifact).expect("artifact directory");
        std::fs::write(artifact.join("one-publish-events-linux.json"), b"")
            .expect("write an empty segment");
        let error = load_shard_segments(temp.path())
            .expect_err("an undecodable segment must not read as missing evidence");
        assert!(error.to_string().contains("decode shard segment"));
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_never_enter_the_segment_or_candidate_evidence_trees() {
        use std::os::unix::fs::symlink;

        // 符号链接目录不被当段：防递归环与根外 JSON 混入证据。
        let segments_root = tempfile::tempdir().expect("segments root");
        let outside = tempfile::tempdir().expect("outside directory");
        let segment = segments_root.path().join("one-publish-events-1-1-linux");
        std::fs::create_dir_all(&segment).expect("segment dir");
        std::fs::write(
            segment.join("one-publish-events-linux.json"),
            serde_json::to_vec(&ShardOutcome {
                events: Vec::new(),
                manifest: None,
                artifacts: Vec::new(),
            })
            .expect("serialize segment"),
        )
        .expect("write segment");
        std::fs::write(
            outside.path().join("smuggled.json"),
            serde_json::to_vec(&ShardOutcome {
                events: Vec::new(),
                manifest: None,
                artifacts: Vec::new(),
            })
            .expect("serialize smuggled"),
        )
        .expect("write outside payload");
        symlink(outside.path(), segments_root.path().join("linked-outside"))
            .expect("create directory symlink");
        symlink(
            outside.path().join("smuggled.json"),
            segment.join("smuggled.json"),
        )
        .expect("create file symlink");
        let events = load_shard_segments(segments_root.path()).expect("load segments");
        assert!(
            events.is_empty(),
            "only the real segment is read; symlinked dirs and files are skipped"
        );

        // 符号链接候选：词法路径合法但字节在外——落盘证据必须拒绝跟随。
        let staging_root = tempfile::tempdir().expect("staging root");
        let segment_dir = staging_root.path().join("linux");
        std::fs::create_dir_all(segment_dir.join("files")).expect("files dir");
        symlink(
            outside.path().join("smuggled.json"),
            segment_dir.join("files").join("0-app.bin"),
        )
        .expect("create candidate symlink");
        std::fs::write(
            segment_dir.join("candidates.json"),
            serde_json::to_vec(&[serde_json::json!({
                "role": "app",
                "file_name": "app.bin",
                "media_type": "application/octet-stream",
                "platform": "linux",
                "architecture": "x86_64",
                "path": "files/0-app.bin",
                "executable": false
            })])
            .expect("serialize candidates"),
        )
        .expect("write candidates manifest");
        let error = load_staged_artifacts(staging_root.path())
            .expect_err("a symlinked candidate must not be followed");
        assert!(error.to_string().contains("is a symlink"));

        // 链接出的"段目录"同样不算候选（独立 fixture：上面的候选符号链接
        // 会先报错，无法隔离本条断言）。
        let linked_root = tempfile::tempdir().expect("linked staging root");
        symlink(outside.path(), linked_root.path().join("linked-segment"))
            .expect("create staging segment symlink");
        assert!(load_staged_artifacts(linked_root.path())
            .expect("load staging root")
            .is_empty());
    }
}
