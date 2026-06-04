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
use super::{AppState, ExecutionRecord, PublishConfigStore, RepoPublishConfig, Repository};
use std::collections::BTreeMap;
use std::fs;
use tempfile::TempDir;

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
