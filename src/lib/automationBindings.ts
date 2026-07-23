import { invoke } from "@tauri-apps/api/core";

import type {
  AutomationApplyResult,
  AutomationBindingsView,
  AutomationChangeRequest,
  AutomationProjectionPreview,
} from "@/generated/tauri-contracts";

export type {
  AutomationApplyResult,
  AutomationBindingsView,
  AutomationChangeRequest,
  AutomationProjectionPreview,
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
