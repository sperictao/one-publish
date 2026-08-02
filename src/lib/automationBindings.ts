import { invoke } from "@tauri-apps/api/core";

import type {
  AutomationApplyResult,
  AutomationBindingsView,
  AutomationChangeRequest,
  AutomationProjectionPreview,
  ManualDispatchResult,
  RemoteAttemptEvidenceView,
} from "@/generated/tauri-contracts";

export type {
  AutomationApplyResult,
  AutomationBindingsView,
  AutomationChangeRequest,
  AutomationProjectionPreview,
  ManualDispatchResult,
  RemoteAttemptEvidenceView,
} from "@/generated/tauri-contracts";

export async function listAutomationBindings(
  repoId: string
): Promise<AutomationBindingsView> {
  return invoke<AutomationBindingsView>("list_automation_bindings", { repoId });
}

export async function previewAutomationChange(
  repoId: string,
  change: AutomationChangeRequest
): Promise<AutomationProjectionPreview> {
  return invoke<AutomationProjectionPreview>("preview_automation_change", {
    repoId,
    change,
  });
}

export async function applyAutomationChange(
  repoId: string,
  change: AutomationChangeRequest,
  confirmedDigest: string
): Promise<AutomationApplyResult> {
  return invoke<AutomationApplyResult>("apply_automation_change", {
    repoId,
    change,
    confirmedDigest,
  });
}

export async function synchronizeRemoteEvidence(
  repoId: string
): Promise<RemoteAttemptEvidenceView[]> {
  return invoke<RemoteAttemptEvidenceView[]>(
    "synchronize_remote_publish_evidence",
    { repoId }
  );
}

export async function dispatchManualPublishRun(
  repoId: string,
  bindingId: string,
  version: string
): Promise<ManualDispatchResult> {
  return invoke<ManualDispatchResult>("dispatch_manual_publish_run", {
    repoId,
    bindingId,
    version,
  });
}

export async function cancelRemotePublishRun(
  repoId: string,
  runId: number
): Promise<void> {
  return invoke<void>("cancel_remote_publish_run", { repoId, runId });
}
