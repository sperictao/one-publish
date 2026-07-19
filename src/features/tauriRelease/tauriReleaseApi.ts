import { invoke } from "@tauri-apps/api/core";

import type {
  ManagedWorkflowPreview,
  ReleaseAttempt,
  StartTauriGithubReleaseRequest,
  TauriLocalBuildResult,
  TauriReleaseConfig,
  TauriReleasePreflight,
  TauriRepositoryInspection,
  WorkflowTakeoverResult,
} from "@/generated/tauri-contracts";

export function inspectTauriRepository(repositoryPath: string) {
  return invoke<TauriRepositoryInspection>("inspect_tauri_repository", {
    repositoryPath,
  });
}

export function getTauriReleaseConfig(repositoryId: string) {
  return invoke<TauriReleaseConfig | null>("get_tauri_release_config", {
    repositoryId,
  });
}

export function saveTauriReleaseConfig(
  repositoryId: string,
  config: TauriReleaseConfig
) {
  return invoke<TauriReleaseConfig>("save_tauri_release_config", {
    repositoryId,
    config,
  });
}

export function previewTauriManagedWorkflow(repositoryId: string) {
  return invoke<ManagedWorkflowPreview>("preview_tauri_managed_workflow", {
    repositoryId,
  });
}

export function applyTauriWorkflowTakeover(
  repositoryId: string,
  previewId: string
) {
  return invoke<WorkflowTakeoverResult>("apply_tauri_workflow_takeover", {
    repositoryId,
    previewId,
    confirmed: true,
  });
}

export function executeTauriLocalBuild(repositoryId: string) {
  return invoke<TauriLocalBuildResult>("execute_tauri_local_build", {
    repositoryId,
  });
}

export function prepareTauriGithubRelease(
  repositoryId: string,
  version: string
) {
  return invoke<TauriReleasePreflight>("prepare_tauri_github_release", {
    repositoryId,
    version,
  });
}

export function startTauriGithubRelease(
  request: StartTauriGithubReleaseRequest
) {
  return invoke<ReleaseAttempt>("start_tauri_github_release", { request });
}

export function listTauriReleaseAttempts(repositoryId: string) {
  return invoke<ReleaseAttempt[]>("list_tauri_release_attempts", {
    repositoryId,
  });
}

export function refreshTauriReleaseAttempt(attemptId: string) {
  return invoke<ReleaseAttempt>("refresh_tauri_release_attempt", {
    attemptId,
  });
}

export function cancelTauriReleaseAttempt(attemptId: string) {
  return invoke<ReleaseAttempt>("cancel_tauri_release_attempt", {
    attemptId,
  });
}

export function retryTauriReleaseAttempt(attemptId: string) {
  return invoke<ReleaseAttempt>("retry_tauri_release_attempt", {
    attemptId,
  });
}

export function exportTauriReleaseConfig(
  repositoryId: string,
  filePath: string
) {
  return invoke<string>("export_tauri_release_config", {
    repositoryId,
    filePath,
  });
}

export function importTauriReleaseConfig(
  repositoryId: string,
  filePath: string
) {
  return invoke<TauriReleaseConfig>("import_tauri_release_config", {
    repositoryId,
    filePath,
  });
}
