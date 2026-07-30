use super::migration::{sanitize_state, StoredAppState};
use super::persistence::{load_from_path, save_to_path};
use super::recent::{
    push_recent_publish_config_state, remove_recent_publish_config_state,
    replace_recent_publish_config_key_state, sanitize_recent_publish_state,
};
use super::runtime::{
    apply_selected_repo_id_update, build_frontend_state, find_repository,
    validate_repository_project_binding,
};
use super::{
    AppState, AutomationBinding, AutomationTriggerPolicy, ConfigurationImport, ExecutionRecord,
    PublishConfigStore, RepoPublishConfig, Repository,
};
use std::collections::BTreeMap;
use std::fs;
use tempfile::TempDir;

fn test_runtime_revision() -> publish_domain::AutomationRuntimeRevision {
    one_publish_runner::current_runtime_revision([publish_domain::AdapterIdentity::new(
        publish_domain::AdapterKind::ExecutionBackend,
        "fake-automation",
        1,
    )])
    .expect("seal test runtime revision")
}

fn test_binding(configuration_id: &str, configuration_revision_id: &str) -> AutomationBinding {
    AutomationBinding {
        id: "binding-1".to_string(),
        configuration_id: configuration_id.to_string(),
        configuration_revision_id: configuration_revision_id.to_string(),
        execution_backend_id: "fake-automation".to_string(),
        trigger_policy: AutomationTriggerPolicy::TagPush {
            tag_prefix: "v".to_string(),
        },
        backend_projection: serde_json::Value::Null,
        runtime_revision: test_runtime_revision().into(),
        external_identity: "one-publish/automation/binding-1.json".to_string(),
        created_at: "2026-07-21T10:00:00Z".to_string(),
        updated_at: "2026-07-21T10:00:00Z".to_string(),
    }
}

fn test_repo(id: &str) -> Repository {
    Repository {
        id: id.to_string(),
        name: format!("Repo {id}"),
        path: format!("/{id}"),
        project_file: None,
        current_branch: "main".to_string(),
        branches: Vec::new(),
        is_main: true,
        provider_id: Some("dotnet".to_string()),
        publish_config: RepoPublishConfig::default(),
    }
}

#[test]
fn repo_publish_config_create_profile_assigns_identity_and_initial_revision() {
    let mut config = RepoPublishConfig::default();

    let profile = config
        .create_profile(
            "Release".to_string(),
            "dotnet".to_string(),
            serde_json::json!({ "configuration": "Release" }),
            Some("Production".to_string()),
            "2026-07-21T10:00:00Z".to_string(),
        )
        .expect("create profile");

    assert!(!profile.id.is_empty());
    assert_eq!(profile.current_revision_id, profile.revisions[0].id);
    assert_eq!(profile.revisions.len(), 1);
    assert_eq!(profile.revisions[0].sequence, 1);
    assert_eq!(profile.revisions[0].contract_version, 1);
    assert_eq!(profile.revisions[0].provider_version, "1");
    assert_eq!(profile.revisions[0].settings_version, 1);
    assert_eq!(profile.revisions[0].provider_id, "dotnet");
    assert_eq!(
        profile.revisions[0].parameters,
        serde_json::json!({ "configuration": "Release" })
    );
    assert_eq!(profile.profile_group.as_deref(), Some("Production"));
    assert_eq!(profile.blocked_reason, None);
}

#[test]
fn repo_publish_config_content_update_appends_revision_without_moving_binding() {
    let mut config = RepoPublishConfig::default();
    let created = config
        .create_profile(
            "Release".to_string(),
            "dotnet".to_string(),
            serde_json::json!({ "configuration": "Release" }),
            None,
            "2026-07-21T10:00:00Z".to_string(),
        )
        .expect("create profile")
        .clone();
    let original_revision_id = created.current_revision_id.clone();
    config
        .bindings
        .push(test_binding(&created.id, &original_revision_id));

    config
        .update_profile(
            &created.id,
            "Release".to_string(),
            "dotnet".to_string(),
            serde_json::json!({ "configuration": "Debug" }),
            None,
            "2026-07-21T11:00:00Z".to_string(),
        )
        .expect("update profile");

    let updated = config.profile(&created.id).expect("updated profile");
    assert_eq!(updated.revisions.len(), 2);
    assert_eq!(updated.revisions[0].id, original_revision_id);
    assert_eq!(updated.revisions[1].sequence, 2);
    assert_eq!(updated.current_revision_id, updated.revisions[1].id);
    assert_eq!(
        updated.revisions[1].parameters,
        serde_json::json!({ "configuration": "Debug" })
    );
    assert_eq!(
        config.bindings[0].configuration_revision_id,
        updated.revisions[0].id
    );
}

#[test]
fn switching_the_current_configuration_never_touches_automation_bindings() {
    let mut config = RepoPublishConfig::default();
    let bound = config
        .create_profile(
            "Stable".to_string(),
            "dotnet".to_string(),
            serde_json::json!({ "configuration": "Release" }),
            None,
            "2026-07-21T10:00:00Z".to_string(),
        )
        .expect("create bound profile")
        .clone();
    let other = config
        .create_profile(
            "Nightly".to_string(),
            "dotnet".to_string(),
            serde_json::json!({ "configuration": "Debug" }),
            None,
            "2026-07-21T10:05:00Z".to_string(),
        )
        .expect("create other profile")
        .clone();
    config
        .bindings
        .push(test_binding(&bound.id, &bound.current_revision_id));
    let bindings_before = config.bindings.clone();
    let bundles_before = config.applied_bundles.clone();

    config.select_profile(&other.id).expect("select other");
    config.select_profile(&bound.id).expect("select bound");
    config
        .select_profile(&other.id)
        .expect("select other again");

    assert_eq!(config.bindings, bindings_before);
    assert_eq!(config.applied_bundles, bundles_before);
    assert_eq!(config.selected_preset, format!("userprofile:{}", other.id));
}

#[test]
fn repo_publish_config_selection_and_identity_references_survive_rename() {
    let mut repo = test_repo("repo-1");
    let created = repo
        .publish_config
        .create_profile(
            "Before".to_string(),
            "dotnet".to_string(),
            serde_json::json!({ "configuration": "Release" }),
            None,
            "2026-07-21T10:00:00Z".to_string(),
        )
        .expect("create profile")
        .clone();
    repo.publish_config
        .select_profile(&created.id)
        .expect("select profile");
    assert!(repo.publish_config.is_custom_mode);
    repo.publish_config
        .bindings
        .push(test_binding(&created.id, &created.current_revision_id));
    let recent_key = format!("userprofile:{}", created.id);
    let mut state = AppState {
        repositories: vec![repo],
        recent_repo_ids: vec!["repo-1".to_string()],
        recent_config_keys_by_repo: BTreeMap::from([(
            "repo-1".to_string(),
            vec![recent_key.clone()],
        )]),
        execution_history: vec![ExecutionRecord {
            id: "history-1".to_string(),
            repo_id: Some("repo-1".to_string()),
            configuration_id: Some(created.id.clone()),
            configuration_revision_id: Some(created.current_revision_id.clone()),
            provider_id: "dotnet".to_string(),
            project_path: "/repo/App.csproj".to_string(),
            started_at: "2026-07-21T10:00:00Z".to_string(),
            finished_at: "2026-07-21T10:01:00Z".to_string(),
            success: true,
            cancelled: false,
            output_dir: None,
            error: None,
            command_line: None,
            snapshot_path: None,
            failure_signature: None,
            output_excerpt: None,
            spec: None,
            file_count: 0,
            warnings: None,
        }],
        ..AppState::default()
    };

    state.repositories[0]
        .publish_config
        .update_profile(
            &created.id,
            "After".to_string(),
            "dotnet".to_string(),
            serde_json::json!({ "configuration": "Release" }),
            Some("Renamed Group".to_string()),
            "2026-07-21T11:00:00Z".to_string(),
        )
        .expect("rename profile");

    let config = &state.repositories[0].publish_config;
    let renamed = config.profile(&created.id).expect("renamed profile");
    assert_eq!(renamed.name, "After");
    assert_eq!(renamed.profile_group.as_deref(), Some("Renamed Group"));
    assert_eq!(renamed.revisions.len(), 1);
    assert_eq!(renamed.current_revision_id, created.current_revision_id);
    assert_eq!(config.selected_preset, recent_key);
    assert_eq!(
        state.recent_config_keys_by_repo["repo-1"],
        vec![format!("userprofile:{}", created.id)]
    );
    assert_eq!(
        state.execution_history[0].configuration_id.as_deref(),
        Some(created.id.as_str())
    );
    assert_eq!(
        state.execution_history[0]
            .configuration_revision_id
            .as_deref(),
        Some(created.current_revision_id.as_str())
    );
    assert_eq!(config.bindings[0].configuration_id, created.id);
    assert_eq!(
        config.bindings[0].configuration_revision_id,
        created.current_revision_id
    );
}

#[test]
fn repo_publish_config_delete_is_blocked_by_binding_then_tombstones_history() {
    let mut config = RepoPublishConfig::default();
    let created = config
        .create_profile(
            "Release".to_string(),
            "dotnet".to_string(),
            serde_json::json!({ "configuration": "Release" }),
            None,
            "2026-07-21T10:00:00Z".to_string(),
        )
        .expect("create profile")
        .clone();
    config.select_profile(&created.id).expect("select profile");
    config
        .bindings
        .push(test_binding(&created.id, &created.current_revision_id));

    let error = config
        .delete_profile(&created.id, "2026-07-21T11:00:00Z".to_string())
        .expect_err("bound profile deletion should be blocked");
    assert_eq!(
        error.code.as_deref(),
        Some("profile_delete_blocked_by_binding")
    );
    assert_eq!(config.active_profiles().len(), 1);

    config.bindings.clear();
    config
        .delete_profile(&created.id, "2026-07-21T11:00:00Z".to_string())
        .expect("delete unbound profile");

    assert!(config.active_profiles().is_empty());
    let tombstone = config
        .profile(&created.id)
        .expect("tombstone remains resolvable");
    assert_eq!(
        tombstone.deleted_at.as_deref(),
        Some("2026-07-21T11:00:00Z")
    );
    assert_eq!(tombstone.current_revision_id, created.current_revision_id);
    assert_eq!(tombstone.revisions, created.revisions);
    assert_eq!(config.selected_preset, "release-fd");
}

#[test]
fn repo_publish_config_import_creates_unselected_identity_and_skips_duplicate_name() {
    let mut config = RepoPublishConfig::default();
    let selected = config
        .create_profile(
            "Existing".to_string(),
            "dotnet".to_string(),
            serde_json::json!({ "configuration": "Release" }),
            None,
            "2026-07-21T10:00:00Z".to_string(),
        )
        .expect("create selected profile")
        .clone();
    config
        .select_profile(&selected.id)
        .expect("select existing profile");
    config
        .bindings
        .push(test_binding(&selected.id, &selected.current_revision_id));

    let duplicate = config
        .import_profile(ConfigurationImport {
            name: "Existing".to_string(),
            provider_id: "dotnet".to_string(),
            contract_version: 1,
            provider_version: "1".to_string(),
            settings_version: 1,
            parameters: serde_json::json!({ "configuration": "Debug" }),
            profile_group: Some("Should Not Replace".to_string()),
            created_at: "2026-07-21T11:00:00Z".to_string(),
            is_system_default: false,
        })
        .expect("duplicate import should be an explicit skip");
    assert!(duplicate.is_none());
    assert_eq!(
        config
            .profile(&selected.id)
            .expect("existing profile")
            .current_revision()
            .expect("existing revision")
            .parameters,
        serde_json::json!({ "configuration": "Release" })
    );

    let imported = config
        .import_profile(ConfigurationImport {
            name: "Unknown Adapter".to_string(),
            provider_id: "future-provider".to_string(),
            contract_version: 1,
            provider_version: "7".to_string(),
            settings_version: 3,
            parameters: serde_json::json!({ "futureSetting": true }),
            profile_group: None,
            created_at: "2026-07-21T12:00:00Z".to_string(),
            is_system_default: false,
        })
        .expect("import profile")
        .expect("new profile should be imported")
        .clone();

    assert_ne!(imported.id, selected.id);
    assert_ne!(imported.current_revision_id, selected.current_revision_id);
    let imported_revision = imported.current_revision().expect("imported revision");
    assert_eq!(imported_revision.provider_id, "future-provider");
    assert_eq!(imported_revision.provider_version, "7");
    assert_eq!(imported_revision.settings_version, 3);
    assert_eq!(
        imported.blocked_reason.as_deref(),
        Some("provider_unavailable:future-provider")
    );
    assert_eq!(
        config.selected_preset,
        format!("userprofile:{}", selected.id)
    );
    assert_eq!(config.bindings.len(), 1);
    assert!(config
        .bindings
        .iter()
        .all(|binding| binding.configuration_id != imported.id));
}

#[test]
fn repo_publish_config_reorders_active_profiles_by_id_without_new_revisions() {
    let mut config = RepoPublishConfig::default();
    let alpha = config
        .create_profile(
            "Alpha".to_string(),
            "dotnet".to_string(),
            serde_json::json!({}),
            None,
            "2026-07-21T10:00:00Z".to_string(),
        )
        .expect("create alpha")
        .clone();
    let beta = config
        .create_profile(
            "Beta".to_string(),
            "cargo".to_string(),
            serde_json::json!({}),
            None,
            "2026-07-21T11:00:00Z".to_string(),
        )
        .expect("create beta")
        .clone();

    config
        .reorder_profiles(vec![
            (beta.id.clone(), Some("First".to_string())),
            (alpha.id.clone(), None),
        ])
        .expect("reorder profiles");

    assert_eq!(
        config
            .active_profiles()
            .iter()
            .map(|profile| profile.id.as_str())
            .collect::<Vec<_>>(),
        vec![beta.id.as_str(), alpha.id.as_str()]
    );
    assert_eq!(
        config
            .profile(&beta.id)
            .expect("beta")
            .profile_group
            .as_deref(),
        Some("First")
    );
    assert_eq!(config.profile(&alpha.id).expect("alpha").revisions.len(), 1);
    assert_eq!(config.profile(&beta.id).expect("beta").revisions.len(), 1);
}

#[test]
fn bootstrap_state_serialization_excludes_execution_history() {
    let state = AppState {
        repositories: vec![Repository {
            id: "repo-1".to_string(),
            name: "one-publish".to_string(),
            path: "/repo".to_string(),
            project_file: None,
            current_branch: "main".to_string(),
            branches: Vec::new(),
            is_main: true,
            provider_id: Some("dotnet".to_string()),
            publish_config: RepoPublishConfig::default(),
        }],
        execution_history: vec![ExecutionRecord {
            id: "history-1".to_string(),
            repo_id: Some("repo-1".to_string()),
            configuration_id: None,
            configuration_revision_id: None,
            provider_id: "dotnet".to_string(),
            project_path: "/repo/App.csproj".to_string(),
            started_at: "2026-03-28T10:00:00.000Z".to_string(),
            finished_at: "2026-03-28T10:00:03.000Z".to_string(),
            success: true,
            cancelled: false,
            output_dir: Some("/repo/out".to_string()),
            error: None,
            command_line: None,
            snapshot_path: None,
            failure_signature: None,
            output_excerpt: None,
            spec: None,
            file_count: 2,
            warnings: None,
        }],
        ..AppState::default()
    };

    let frontend_state = build_frontend_state(&state);
    let serialized = serde_json::to_value(&frontend_state).expect("serialize frontend state");

    assert_eq!(
        serialized
            .get("executionHistory")
            .and_then(serde_json::Value::as_array)
            .map(Vec::len),
        Some(0),
        "前端启动载荷不应携带执行历史内容"
    );
    assert_eq!(
        serialized
            .get("repositories")
            .and_then(serde_json::Value::as_array)
            .map(Vec::len),
        Some(1)
    );
    assert_eq!(
        serialized.get("startupNotice"),
        Some(&serde_json::Value::Null)
    );
}

#[test]
fn bootstrap_state_exposes_only_active_profiles_while_storage_keeps_tombstones() {
    let mut repo = test_repo("repo-1");
    let deleted = repo
        .publish_config
        .create_profile(
            "Deleted".to_string(),
            "dotnet".to_string(),
            serde_json::json!({}),
            None,
            "2026-07-21T10:00:00Z".to_string(),
        )
        .expect("create deleted profile")
        .clone();
    repo.publish_config
        .create_profile(
            "Active".to_string(),
            "dotnet".to_string(),
            serde_json::json!({}),
            None,
            "2026-07-21T11:00:00Z".to_string(),
        )
        .expect("create active profile");
    repo.publish_config
        .delete_profile(&deleted.id, "2026-07-21T12:00:00Z".to_string())
        .expect("delete profile");
    let state = AppState {
        repositories: vec![repo],
        ..AppState::default()
    };

    let frontend = build_frontend_state(&state);

    assert_eq!(state.repositories[0].publish_config.profiles.len(), 2);
    assert_eq!(frontend.repositories[0].publish_config.profiles.len(), 1);
    assert_eq!(
        frontend.repositories[0].publish_config.profiles[0].name,
        "Active"
    );
    assert!(state.repositories[0]
        .publish_config
        .profile(&deleted.id)
        .is_some());
}

#[test]
fn legacy_execution_record_keeps_configuration_identity_unresolved() {
    let record: ExecutionRecord = serde_json::from_value(serde_json::json!({
        "id": "history-1",
        "repoId": "repo-1",
        "providerId": "dotnet",
        "projectPath": "/repo/App.csproj",
        "startedAt": "2026-07-21T10:00:00Z",
        "finishedAt": "2026-07-21T10:01:00Z",
        "success": true,
        "outputDir": null,
        "error": null,
        "commandLine": null,
        "snapshotPath": null,
        "failureSignature": null,
        "spec": null
    }))
    .expect("deserialize legacy execution record");

    assert_eq!(record.configuration_id, None);
    assert_eq!(record.configuration_revision_id, None);
}

#[test]
fn save_to_path_writes_clean_schema_atomically() {
    let temp_dir = TempDir::new().expect("temp dir");
    let config_path = temp_dir.path().join("config.json");
    let state = AppState {
        repositories: vec![test_repo("repo-1")],
        startup_notice: Some("should not persist".to_string()),
        ..AppState::default()
    };

    save_to_path(&state, &config_path).expect("save config");

    let content = fs::read_to_string(&config_path).expect("read config");
    let persisted: StoredAppState =
        serde_json::from_str(&content).expect("deserialize clean schema");
    let persisted_json =
        serde_json::from_str::<serde_json::Value>(&content).expect("deserialize value");

    assert_eq!(persisted.repositories.len(), 1);
    assert!(persisted_json.get("selectedPreset").is_none());
    assert!(persisted_json.get("isCustomMode").is_none());
    assert!(persisted_json.get("customConfig").is_none());
    assert!(persisted_json.get("profiles").is_none());
    assert!(persisted_json.get("startupNotice").is_none());
    let temp_entries = fs::read_dir(temp_dir.path())
        .expect("read temp dir")
        .flatten()
        .filter(|entry| entry.file_name().to_string_lossy().contains(".tmp."))
        .count();
    assert_eq!(temp_entries, 0);
}

#[test]
fn save_to_path_replaces_existing_config_file() {
    let temp_dir = TempDir::new().expect("temp dir");
    let config_path = temp_dir.path().join("config.json");
    let initial_state = AppState {
        language: "zh".to_string(),
        ..AppState::default()
    };
    let next_state = AppState {
        language: "en".to_string(),
        repositories: vec![test_repo("repo-1")],
        ..AppState::default()
    };

    save_to_path(&initial_state, &config_path).expect("save initial config");
    save_to_path(&next_state, &config_path).expect("replace existing config");

    let persisted = fs::read_to_string(&config_path).expect("read config");
    let persisted_state: StoredAppState =
        serde_json::from_str(&persisted).expect("deserialize config");

    assert_eq!(persisted_state.language, "en");
    assert_eq!(persisted_state.repositories.len(), 1);
}

#[test]
fn load_from_path_migrates_legacy_global_publish_fields() {
    let temp_dir = TempDir::new().expect("temp dir");
    let config_path = temp_dir.path().join("config.json");
    let legacy_payload = serde_json::json!({
        "repositories": [
            {
                "id": "repo-1",
                "name": "Repo 1",
                "path": "/repo-1",
                "currentBranch": "main",
                "branches": [],
                "isMain": true,
                "providerId": "dotnet",
                "publishConfig": {
                    "selectedPreset": "release-fd",
                    "isCustomMode": false,
                    "customConfig": PublishConfigStore::default(),
                    "profiles": []
                }
            }
        ],
        "selectedPreset": "profile-FolderProfile",
        "isCustomMode": true,
        "customConfig": {
            "configuration": "Debug",
            "runtime": "win-x64",
            "framework": "",
            "selfContained": true,
            "outputDir": "",
            "noBuild": false,
            "noRestore": false,
            "verbosity": "",
            "noLogo": false,
            "properties": {},
            "useProfile": false,
            "profileName": ""
        },
        "profiles": [
            {
                "name": "legacy-profile",
                "providerId": "dotnet",
                "parameters": {},
                "createdAt": "2026-04-02T10:00:00Z",
                "isSystemDefault": false
            }
        ]
    });
    fs::write(
        &config_path,
        serde_json::to_vec_pretty(&legacy_payload).expect("serialize legacy payload"),
    )
    .expect("write legacy config");

    let state = load_from_path(&config_path);
    let repo_publish_config = &state.repositories[0].publish_config;

    assert_eq!(repo_publish_config.selected_preset, "profile-FolderProfile");
    assert!(repo_publish_config.is_custom_mode);
    assert_eq!(repo_publish_config.custom_config.configuration, "Debug");
    assert_eq!(repo_publish_config.profiles.len(), 1);
    assert!(state.startup_notice.is_none());
}

#[test]
fn load_from_path_migrates_name_based_profiles_once_and_writes_versioned_schema() {
    let temp_dir = TempDir::new().expect("temp dir");
    let config_path = temp_dir.path().join("config.json");
    let legacy_payload = serde_json::json!({
        "repositories": [
            {
                "id": "repo-1",
                "name": "Repo 1",
                "path": "/repo-1",
                "currentBranch": "main",
                "branches": [],
                "isMain": true,
                "providerId": "dotnet",
                "publishConfig": {
                    "selectedPreset": "userprofile:Beta",
                    "isCustomMode": false,
                    "customConfig": PublishConfigStore::default(),
                    "profiles": [
                        {
                            "name": "Alpha",
                            "providerId": "cargo",
                            "parameters": { "release": true },
                            "profileGroup": "Build",
                            "createdAt": "2026-04-01T10:00:00Z",
                            "isSystemDefault": false
                        },
                        {
                            "name": "Beta",
                            "providerId": "dotnet",
                            "parameters": { "configuration": "Debug" },
                            "profileGroup": "Deploy",
                            "createdAt": "2026-04-02T11:00:00Z",
                            "isSystemDefault": false
                        }
                    ]
                }
            },
            {
                "id": "repo-2",
                "name": "Repo 2",
                "path": "/repo-2",
                "currentBranch": "main",
                "branches": [],
                "isMain": true,
                "providerId": "dotnet",
                "publishConfig": {
                    "selectedPreset": "profile-FolderProfile",
                    "isCustomMode": false,
                    "customConfig": PublishConfigStore::default(),
                    "profiles": []
                }
            }
        ],
        "recentRepoIds": ["repo-1"],
        "recentConfigKeysByRepo": {
            "repo-1": ["userprofile:Beta", "pubxml:FolderProfile"]
        }
    });
    fs::write(
        &config_path,
        serde_json::to_vec_pretty(&legacy_payload).expect("serialize legacy payload"),
    )
    .expect("write legacy config");

    let first = load_from_path(&config_path);
    let first_config = &first.repositories[0].publish_config;
    assert_eq!(
        first_config
            .active_profiles()
            .iter()
            .map(|profile| profile.name.as_str())
            .collect::<Vec<_>>(),
        vec!["Alpha", "Beta"]
    );
    let alpha = first_config.active_profiles()[0];
    let beta = first_config.active_profiles()[1];
    assert_eq!(alpha.profile_group.as_deref(), Some("Build"));
    assert_eq!(alpha.created_at, "2026-04-01T10:00:00Z");
    assert_eq!(
        alpha.current_revision().expect("alpha revision").parameters,
        serde_json::json!({ "release": true })
    );
    assert_eq!(
        first_config.selected_preset,
        format!("userprofile:{}", beta.id)
    );
    assert_eq!(
        first.recent_config_keys_by_repo["repo-1"],
        vec![
            format!("userprofile:{}", beta.id),
            "pubxml:FolderProfile".to_string()
        ]
    );
    assert_eq!(
        first.repositories[1].publish_config.selected_preset,
        "profile-FolderProfile"
    );

    let persisted = fs::read_to_string(&config_path).expect("read migrated config");
    let persisted_json: serde_json::Value =
        serde_json::from_str(&persisted).expect("parse migrated config");
    assert_eq!(persisted_json["schemaVersion"], 3);
    assert!(
        persisted_json["repositories"][0]["publishConfig"]["profiles"][0]
            .get("providerId")
            .is_none()
    );

    let second = load_from_path(&config_path);
    let second_profiles = second.repositories[0].publish_config.active_profiles();
    assert_eq!(second_profiles[0].id, alpha.id);
    assert_eq!(second_profiles[0].revisions, alpha.revisions);
    assert_eq!(second_profiles[1].id, beta.id);
    assert_eq!(second_profiles[1].revisions, beta.revisions);
}

#[test]
fn load_from_path_preserves_schema_two_runtime_pins_until_explicit_upgrade() {
    let temp = TempDir::new().expect("temp dir");
    let config_path = temp.path().join("config.json");
    let mut repo = test_repo("repo-1");
    repo.publish_config
        .bindings
        .push(test_binding("configuration-1", "revision-1"));
    let state = AppState {
        repositories: vec![repo],
        ..AppState::default()
    };
    save_to_path(&state, &config_path).expect("save current state");

    let mut payload: serde_json::Value =
        serde_json::from_slice(&fs::read(&config_path).expect("read state")).expect("parse state");
    payload["schemaVersion"] = serde_json::Value::from(2);
    payload["repositories"][0]["publishConfig"]["bindings"][0]["runtimeRevision"] =
        serde_json::Value::String("plan-v1.adapter-v1.fake-automation@1".to_string());
    fs::write(
        &config_path,
        serde_json::to_vec_pretty(&payload).expect("serialize schema two state"),
    )
    .expect("write schema two state");

    let loaded = load_from_path(&config_path);
    let pin = &loaded.repositories[0].publish_config.bindings[0].runtime_revision;
    assert_eq!(
        pin,
        &publish_domain::PinnedAutomationRuntimeRevision::Legacy(
            "plan-v1.adapter-v1.fake-automation@1".to_string()
        )
    );

    let persisted: serde_json::Value =
        serde_json::from_slice(&fs::read(&config_path).expect("read migrated state"))
            .expect("parse migrated state");
    assert_eq!(persisted["schemaVersion"], 3);
    assert_eq!(
        persisted["repositories"][0]["publishConfig"]["bindings"][0]["runtimeRevision"],
        "plan-v1.adapter-v1.fake-automation@1"
    );
}

#[test]
fn sanitize_state_migrates_delete_existing_files_properties() {
    let mut legacy_true_repo = test_repo("repo-true");
    legacy_true_repo
        .publish_config
        .custom_config
        .properties
        .insert("deleteExistingFiles".to_string(), "true".to_string());

    let mut legacy_false_repo = test_repo("repo-false");
    legacy_false_repo
        .publish_config
        .custom_config
        .properties
        .insert("DeleteExistingFiles".to_string(), "false".to_string());

    let state = sanitize_state(AppState {
        repositories: vec![legacy_true_repo, legacy_false_repo],
        ..AppState::default()
    });

    let true_config = &state.repositories[0].publish_config.custom_config;
    assert!(true_config.delete_existing_files);
    assert!(!true_config.properties.contains_key("deleteExistingFiles"));

    let false_config = &state.repositories[1].publish_config.custom_config;
    assert!(!false_config.delete_existing_files);
    assert!(!false_config.properties.contains_key("DeleteExistingFiles"));
}

#[test]
fn load_from_path_recovers_from_corrupt_config_and_creates_backup() {
    let temp_dir = TempDir::new().expect("temp dir");
    let config_path = temp_dir.path().join("config.json");
    fs::write(&config_path, "{ not valid json").expect("write corrupt config");

    let state = load_from_path(&config_path);

    assert!(state.repositories.is_empty());
    assert!(state.startup_notice.is_some());
    assert!(!config_path.exists());
    let backup_files = fs::read_dir(temp_dir.path())
        .expect("read temp dir")
        .flatten()
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with("config.corrupt.")
        })
        .count();
    assert_eq!(backup_files, 1);
}

#[tokio::test]
async fn validate_repository_project_binding_requires_explicit_candidate_when_multiple_exist() {
    let temp_dir = TempDir::new().expect("temp dir");
    let project_a = temp_dir.path().join("AppA.csproj");
    let project_b = temp_dir.path().join("AppB.csproj");
    fs::write(&project_a, "<Project />").expect("write project a");
    fs::write(&project_b, "<Project />").expect("write project b");

    let repo = Repository {
        path: temp_dir.path().to_string_lossy().to_string(),
        project_file: Some("/tmp/Other.csproj".to_string()),
        ..test_repo("repo-1")
    };

    let error = validate_repository_project_binding(&repo)
        .await
        .expect_err("invalid explicit binding should be rejected");

    assert_eq!(error.code.as_deref(), Some("multiple_project_files_found"));
}

#[tokio::test]
async fn validate_repository_project_binding_accepts_explicit_candidate_when_multiple_exist() {
    let temp_dir = TempDir::new().expect("temp dir");
    let project_a = temp_dir.path().join("AppA.csproj");
    let project_b = temp_dir.path().join("AppB.csproj");
    fs::write(&project_a, "<Project />").expect("write project a");
    fs::write(&project_b, "<Project />").expect("write project b");

    let repo = Repository {
        path: temp_dir.path().to_string_lossy().to_string(),
        project_file: Some(project_b.to_string_lossy().to_string()),
        ..test_repo("repo-1")
    };

    validate_repository_project_binding(&repo)
        .await
        .expect("explicit candidate binding should pass");
}

#[test]
fn push_recent_publish_config_state_deduplicates_and_truncates() {
    let mut recent_repo_ids = vec![
        "repo-6".to_string(),
        "repo-5".to_string(),
        "repo-4".to_string(),
        "repo-3".to_string(),
        "repo-2".to_string(),
        "repo-1".to_string(),
    ];
    let mut recent_config_keys_by_repo = BTreeMap::from([
        (
            "repo-1".to_string(),
            vec![
                "userprofile:alpha".to_string(),
                "userprofile:beta".to_string(),
                "userprofile:gamma".to_string(),
                "userprofile:delta".to_string(),
                "userprofile:epsilon".to_string(),
                "userprofile:zeta".to_string(),
            ],
        ),
        ("repo-7".to_string(), vec!["userprofile:legacy".to_string()]),
    ]);

    assert!(push_recent_publish_config_state(
        &mut recent_repo_ids,
        &mut recent_config_keys_by_repo,
        "repo-1",
        "userprofile:beta",
    ));

    assert_eq!(recent_repo_ids[0], "repo-1");
    assert_eq!(
        recent_config_keys_by_repo.get("repo-1"),
        Some(&vec![
            "userprofile:beta".to_string(),
            "userprofile:alpha".to_string(),
            "userprofile:gamma".to_string(),
            "userprofile:delta".to_string(),
            "userprofile:epsilon".to_string(),
            "userprofile:zeta".to_string(),
        ])
    );
    assert!(!recent_config_keys_by_repo.contains_key("repo-7"));
}

#[test]
fn remove_recent_publish_config_state_prunes_empty_repo_bucket() {
    let mut recent_repo_ids = vec!["repo-1".to_string()];
    let mut recent_config_keys_by_repo =
        BTreeMap::from([("repo-1".to_string(), vec!["userprofile:alpha".to_string()])]);

    assert!(remove_recent_publish_config_state(
        &mut recent_repo_ids,
        &mut recent_config_keys_by_repo,
        "repo-1",
        "userprofile:alpha",
    ));

    assert!(recent_repo_ids.is_empty());
    assert!(recent_config_keys_by_repo.is_empty());
}

#[test]
fn replace_recent_publish_config_key_state_keeps_order_and_deduplicates() {
    let mut recent_config_keys_by_repo = BTreeMap::from([(
        "repo-1".to_string(),
        vec![
            "userprofile:alpha".to_string(),
            "userprofile:beta".to_string(),
            "userprofile:gamma".to_string(),
        ],
    )]);

    assert!(replace_recent_publish_config_key_state(
        &mut recent_config_keys_by_repo,
        "repo-1",
        "userprofile:beta",
        "userprofile:alpha",
    ));

    assert_eq!(
        recent_config_keys_by_repo.get("repo-1"),
        Some(&vec![
            "userprofile:alpha".to_string(),
            "userprofile:gamma".to_string(),
        ])
    );
}

#[test]
fn sanitize_recent_publish_state_removes_unknown_repositories() {
    let mut state = AppState {
        repositories: vec![test_repo("repo-1"), test_repo("repo-2")],
        recent_repo_ids: vec![
            "repo-3".to_string(),
            "repo-2".to_string(),
            "repo-2".to_string(),
            "repo-1".to_string(),
        ],
        recent_config_keys_by_repo: BTreeMap::from([
            ("repo-1".to_string(), vec!["userprofile:alpha".to_string()]),
            ("repo-2".to_string(), vec!["userprofile:beta".to_string()]),
            ("repo-3".to_string(), vec!["userprofile:stale".to_string()]),
        ]),
        ..AppState::default()
    };

    sanitize_recent_publish_state(&mut state);

    assert_eq!(
        state.recent_repo_ids,
        vec!["repo-2".to_string(), "repo-1".to_string()]
    );
    assert_eq!(state.recent_config_keys_by_repo.len(), 2);
    assert!(!state.recent_config_keys_by_repo.contains_key("repo-3"));
}

#[test]
fn find_repository_returns_consistent_not_found_error() {
    let repositories = vec![test_repo("repo-1")];

    let error = find_repository(&repositories, "repo-2").expect_err("missing repository");

    assert_eq!(error.kind, crate::errors::ErrorKind::Validation);
    assert_eq!(error.code.as_deref(), Some("repository_not_found"));
    assert_eq!(error.message, "未找到仓库: repo-2");
}

#[test]
fn apply_selected_repo_id_update_supports_clearing_selection() {
    let mut state = AppState {
        selected_repo_id: Some("repo-1".to_string()),
        ..AppState::default()
    };

    apply_selected_repo_id_update(&mut state, None, true);
    assert_eq!(state.selected_repo_id, None);

    apply_selected_repo_id_update(&mut state, Some("repo-2".to_string()), false);
    assert_eq!(state.selected_repo_id, Some("repo-2".to_string()));
}

fn stored_state_with_repositories(repositories: serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "schemaVersion": 3,
        "repositories": repositories,
        "leftPanelWidth": 220,
        "middlePanelWidth": 280,
        "panelWidthsCustomized": false,
        "minimizeToTrayOnClose": true,
        "language": "zh",
        "defaultOutputDir": "",
        "theme": "auto",
        "executionHistoryLimit": 20,
        "environmentProviderIds": ["dotnet"],
        "recentRepoIds": [],
        "recentConfigKeysByRepo": {},
        "executionHistory": []
    })
}

fn stored_repo(id: &str, profiles: serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "id": id,
        "name": id,
        "path": format!("/{id}"),
        "currentBranch": "main",
        "branches": [],
        "isMain": true,
        "providerId": "tauri",
        "publishConfig": {
            "selectedPreset": "release-fd",
            "isCustomMode": false,
            "customConfig": PublishConfigStore::default(),
            "profiles": profiles
        }
    })
}

fn legacy_tauri_release_config(tag_prefix: &str) -> serde_json::Value {
    serde_json::json!({
        "appConfigPath": "src-tauri/tauri.conf.json",
        "appName": "Demo App",
        "buildDriver": "pnpm",
        "enabledTargets": ["linux_x64"],
        "releaseAssetPatterns": ["*.AppImage"],
        "updater": {
            "enabled": false,
            "endpoint": null,
            "publicKey": null,
            "privateKeySecretName": null
        },
        "allowUnsignedRelease": true,
        "requiredActionsSecretNames": [],
        "actionsSecretEnvironment": {},
        "tagPrefix": tag_prefix,
        "releaseGates": [{ "program": "git", "args": ["status"] }],
        "localDeliveryDir": "dist/one-publish",
        "versionMirrors": [],
        "managedWorkflowVersion": 1
    })
}

#[test]
fn load_from_path_migrates_tauri_release_settings_into_the_catalog_once() {
    let temp_dir = TempDir::new().expect("temp dir");
    let config_path = temp_dir.path().join("config.json");
    let legacy_release_path = temp_dir.path().join("tauri-release.json");

    let existing_profile = serde_json::json!({
        "id": "configuration-existing",
        "name": "Desktop Build",
        "createdAt": "2026-05-01T10:00:00Z",
        "isSystemDefault": false,
        "currentRevisionId": "revision-existing",
        "revisions": [
            {
                "id": "revision-existing",
                "sequence": 1,
                "createdAt": "2026-05-01T10:00:00Z",
                "contractVersion": 1,
                "providerId": "tauri",
                "providerVersion": "1",
                "settingsVersion": 1,
                "parameters": { "target": "x86_64-unknown-linux-gnu" }
            }
        ]
    });
    fs::write(
        &config_path,
        serde_json::to_vec_pretty(&stored_state_with_repositories(serde_json::json!([
            stored_repo("repo-1", serde_json::json!([existing_profile])),
            stored_repo("repo-2", serde_json::json!([])),
        ])))
        .expect("serialize stored state"),
    )
    .expect("write stored config");
    fs::write(
        &legacy_release_path,
        serde_json::to_vec_pretty(&serde_json::json!({
            "version": 1,
            "configs": {
                "repo-1": legacy_tauri_release_config("app-v"),
                "repo-2": legacy_tauri_release_config("v"),
                "repo-gone": legacy_tauri_release_config("orphan-v")
            },
            "attempts": [
                {
                    "id": "attempt-1",
                    "repositoryId": "repo-1",
                    "version": "1.2.3",
                    "tag": "app-v1.2.3",
                    "stage": "failed",
                    "createdAt": "2026-06-01T10:00:00Z",
                    "updatedAt": "2026-06-01T10:05:00Z"
                }
            ]
        }))
        .expect("serialize legacy tauri release state"),
    )
    .expect("write legacy tauri release state");

    let state = load_from_path(&config_path);

    // repo-1：已有 Tauri 配置获得携带 releaseSettings 的新修订，旧修订保持不可变。
    let migrated = state.repositories[0]
        .publish_config
        .profile("configuration-existing")
        .expect("existing profile survives migration");
    assert_eq!(migrated.revisions.len(), 2);
    let original = &migrated.revisions[0];
    assert_eq!(original.parameters["target"], "x86_64-unknown-linux-gnu");
    assert!(original.parameters.get("releaseSettings").is_none());
    let current = migrated.current_revision().expect("current revision");
    assert_eq!(current.sequence, 2);
    assert_eq!(current.parameters["target"], "x86_64-unknown-linux-gnu");
    assert_eq!(current.parameters["releaseSettings"]["tagPrefix"], "app-v");
    assert_eq!(
        current.parameters["releaseSettings"]["releaseGates"][0]["program"],
        "git"
    );

    // repo-2：没有 Tauri 配置时迁移创建一份新配置。
    let created = state.repositories[1]
        .publish_config
        .active_profiles()
        .into_iter()
        .find(|profile| {
            profile
                .current_revision()
                .is_some_and(|revision| revision.provider_id == "tauri")
        })
        .expect("migration creates a tauri profile")
        .clone();
    assert_eq!(created.name, "Demo App");
    let created_revision = created.current_revision().expect("created revision");
    assert_eq!(
        created_revision.parameters["releaseSettings"]["tagPrefix"],
        "v"
    );

    // 迁移是一次性的：旧存储文件被处置，重新加载不再追加修订。
    assert!(!legacy_release_path.exists());
    // 历史 Attempt 是不可再生证据：含 Attempt 的旧文件按原文归档而不是删除。
    let archive_path = fs::read_dir(temp_dir.path())
        .expect("read temp dir")
        .flatten()
        .map(|entry| entry.path())
        .find(|path| {
            path.file_name()
                .map(|name| {
                    name.to_string_lossy()
                        .starts_with("tauri-release.attempts.")
                })
                .unwrap_or(false)
        })
        .expect("legacy attempts are archived");
    let archived: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&archive_path).expect("read archive"))
            .expect("archive stays valid JSON");
    assert_eq!(archived["attempts"][0]["id"], "attempt-1");
    assert_eq!(archived["attempts"][0]["tag"], "app-v1.2.3");
    let second = load_from_path(&config_path);
    let reloaded = second.repositories[0]
        .publish_config
        .profile("configuration-existing")
        .expect("profile persists");
    assert_eq!(reloaded.revisions.len(), 2);
}

#[test]
fn load_from_path_removes_a_legacy_tauri_release_file_without_attempts() {
    let temp_dir = TempDir::new().expect("temp dir");
    let config_path = temp_dir.path().join("config.json");
    let legacy_release_path = temp_dir.path().join("tauri-release.json");
    fs::write(
        &config_path,
        serde_json::to_vec_pretty(&stored_state_with_repositories(serde_json::json!([
            stored_repo("repo-1", serde_json::json!([])),
        ])))
        .expect("serialize stored state"),
    )
    .expect("write stored config");
    fs::write(
        &legacy_release_path,
        serde_json::to_vec_pretty(&serde_json::json!({
            "version": 1,
            "configs": { "repo-1": legacy_tauri_release_config("v") }
        }))
        .expect("serialize legacy tauri release state"),
    )
    .expect("write legacy tauri release state");

    let state = load_from_path(&config_path);

    // 设置已并入新事实源；没有 Attempt 证据时不留归档，旧文件直接移除。
    assert!(!state.repositories[0]
        .publish_config
        .active_profiles()
        .is_empty());
    assert!(!legacy_release_path.exists());
    let archives = fs::read_dir(temp_dir.path())
        .expect("read temp dir")
        .flatten()
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with("tauri-release.attempts.")
        })
        .count();
    assert_eq!(archives, 0);
}

#[test]
fn load_from_path_removes_an_unreadable_legacy_tauri_release_file_after_backup() {
    let temp_dir = TempDir::new().expect("temp dir");
    let config_path = temp_dir.path().join("config.json");
    let legacy_release_path = temp_dir.path().join("tauri-release.json");
    fs::write(
        &config_path,
        serde_json::to_vec_pretty(&stored_state_with_repositories(serde_json::json!([])))
            .expect("serialize stored state"),
    )
    .expect("write stored config");
    fs::write(&legacy_release_path, "not-json").expect("write invalid legacy state");

    let state = load_from_path(&config_path);

    assert!(state.repositories.is_empty());
    assert!(!legacy_release_path.exists());
    let preserved = fs::read_dir(temp_dir.path())
        .expect("read temp dir")
        .flatten()
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with("tauri-release.invalid.")
        })
        .count();
    assert_eq!(preserved, 1);
}

#[test]
fn update_profile_inherits_release_settings_when_the_editor_omits_them() {
    let mut config = RepoPublishConfig::default();
    let release_settings = serde_json::json!({ "tagPrefix": "v", "appName": "Demo" });
    let profile = config
        .create_profile(
            "Desktop".to_string(),
            "tauri".to_string(),
            serde_json::json!({
                "target": "x86_64-unknown-linux-gnu",
                "releaseSettings": release_settings.clone()
            }),
            None,
            "2026-07-21T10:00:00Z".to_string(),
        )
        .expect("create profile")
        .clone();

    // 参数面板只管理 schema 声明的命令参数；保存不得清除发布设置。
    config
        .update_profile(
            &profile.id,
            "Desktop".to_string(),
            "tauri".to_string(),
            serde_json::json!({ "target": "aarch64-apple-darwin" }),
            None,
            "2026-07-22T10:00:00Z".to_string(),
        )
        .expect("update profile");

    let updated = config.profile(&profile.id).expect("profile");
    assert_eq!(updated.revisions.len(), 2);
    let current = updated.current_revision().expect("current revision");
    assert_eq!(current.parameters["target"], "aarch64-apple-darwin");
    assert_eq!(current.parameters["releaseSettings"], release_settings);

    // 显式携带发布设置的更新（例如迁移或未来的设置编辑器）按传入值生效。
    let changed_settings = serde_json::json!({ "tagPrefix": "app-v" });
    config
        .update_profile(
            &profile.id,
            "Desktop".to_string(),
            "tauri".to_string(),
            serde_json::json!({ "releaseSettings": changed_settings.clone() }),
            None,
            "2026-07-23T10:00:00Z".to_string(),
        )
        .expect("update profile with explicit settings");
    let explicit = config
        .profile(&profile.id)
        .expect("profile")
        .current_revision()
        .expect("current revision")
        .clone();
    assert_eq!(explicit.parameters["releaseSettings"], changed_settings);
    assert!(explicit.parameters.get("target").is_none());
}

#[test]
fn update_profile_does_not_carry_release_settings_across_providers() {
    let mut config = RepoPublishConfig::default();
    let profile = config
        .create_profile(
            "Desktop".to_string(),
            "tauri".to_string(),
            serde_json::json!({ "releaseSettings": { "tagPrefix": "v" } }),
            None,
            "2026-07-21T10:00:00Z".to_string(),
        )
        .expect("create profile")
        .clone();

    // 发布设置属于原 Provider；切换 Provider 的修订不得携带它们。
    config
        .update_profile(
            &profile.id,
            "Desktop".to_string(),
            "cargo".to_string(),
            serde_json::json!({ "release": true }),
            None,
            "2026-07-22T10:00:00Z".to_string(),
        )
        .expect("switch provider");

    let current = config
        .profile(&profile.id)
        .expect("profile")
        .current_revision()
        .expect("current revision")
        .clone();
    assert_eq!(current.provider_id, "cargo");
    assert!(current.parameters.get("releaseSettings").is_none());
}

#[test]
fn a_failed_release_settings_merge_keeps_the_legacy_file_for_retry() {
    let temp_dir = TempDir::new().expect("temp dir");
    let config_path = temp_dir.path().join("config.json");
    let legacy_release_path = temp_dir.path().join("tauri-release.json");

    // 系统默认配置不可更新，迁移并入必然失败。
    let immutable_profile = serde_json::json!({
        "id": "configuration-immutable",
        "name": "Desktop Build",
        "createdAt": "2026-05-01T10:00:00Z",
        "isSystemDefault": true,
        "currentRevisionId": "revision-immutable",
        "revisions": [
            {
                "id": "revision-immutable",
                "sequence": 1,
                "createdAt": "2026-05-01T10:00:00Z",
                "contractVersion": 1,
                "providerId": "tauri",
                "providerVersion": "1",
                "settingsVersion": 1,
                "parameters": {}
            }
        ]
    });
    fs::write(
        &config_path,
        serde_json::to_vec_pretty(&stored_state_with_repositories(serde_json::json!([
            stored_repo("repo-1", serde_json::json!([immutable_profile])),
        ])))
        .expect("serialize stored state"),
    )
    .expect("write stored config");
    fs::write(
        &legacy_release_path,
        serde_json::to_vec_pretty(&serde_json::json!({
            "version": 1,
            "configs": { "repo-1": legacy_tauri_release_config("v") }
        }))
        .expect("serialize legacy tauri release state"),
    )
    .expect("write legacy tauri release state");

    let state = load_from_path(&config_path);

    let profile = state.repositories[0]
        .publish_config
        .profile("configuration-immutable")
        .expect("profile survives");
    assert_eq!(profile.revisions.len(), 1);
    assert!(
        legacy_release_path.exists(),
        "an unmerged legacy config must stay on disk for the next startup"
    );
}
