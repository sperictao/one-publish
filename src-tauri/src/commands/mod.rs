// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
pub(crate) mod artifact;
pub(crate) mod config;
pub(crate) mod environment;
pub(crate) mod export;
pub mod middleware;
pub(crate) mod notification;
pub(crate) mod provider;
pub(crate) mod publish;
pub(crate) mod repository;
pub(crate) mod updater;
pub use artifact::{package_artifact, sign_artifact};
pub use config::{
    apply_imported_config, export_config, import_config, ImportConflictStrategy,
    ImportedConfigSummary,
};
pub use environment::{apply_fix, run_environment_check};
#[cfg(test)]
pub(crate) use export::write_execution_snapshot;
pub use export::{
    export_diagnostics_index, export_execution_history, export_execution_snapshot,
    export_failure_group_bundle, export_handoff_bundle, export_preflight_report, open_directory,
    open_execution_snapshot, open_output_directory,
};
pub use provider::{get_provider_schema, import_from_command, list_providers};
pub use publish::{
    describe_publish_output_target, preflight_publish_output, render_provider_publish,
    ProtectedDirectoryLocation, PublishLogChunkEvent, PublishOutputAccess,
    PublishOutputAccessStatus, PublishOutputPreflightResult, PublishOutputValidation,
    PublishOutputValidationIssue, PublishOutputValidationStatus, PublishResult,
    PublishSessionStartedEvent, RemoteLocationKind, RemoteLocationSummary, RenderedPublishCommand,
};
pub(crate) use publish::{execute_provider_publish, execute_sealed_build, SealedBuildCommand};
pub use repository::{
    check_repository_branch_connectivity, detect_repository_provider, read_project_publish_profile,
    resolve_project_info, scan_project, scan_project_candidates, scan_repository_branches,
    ProjectInfo, ProjectPublishProfileFile, ProjectScanCandidates,
    RepositoryBranchConnectivityResult, RepositoryBranchScanResult, RepositoryProviderCandidate,
    RepositoryProviderDetection,
};
pub(crate) use repository::{
    project_profiles_declaration, resolve_project_file_from_search_path,
    scan_provider_project_candidates_from_path, scan_publish_profiles,
};
pub(crate) use updater::PendingUpdateState;
pub use updater::{
    check_update, get_current_version, get_shortcuts_help, get_updater_config_health,
    get_updater_help_paths, install_update, open_updater_help, UpdateDownloadProgressPayload,
    UpdateInfo, UpdaterConfigHealth, UpdaterHelpPaths,
};
