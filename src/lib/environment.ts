import { invoke } from "@tauri-apps/api/core";

export type IssueSeverity = "critical" | "warning" | "info";

export type IssueType =
  | "missing_tool"
  | "outdated_version"
  | "missing_dependency"
  | "incompatible_version";

export type FixType = "open_url" | "run_command" | "copy_command" | "manual";

export interface FixAction {
  action_type: FixType;
  label: string;
  command?: string | null;
  url?: string | null;
}

export type FixResult =
  | { result: "OpenedUrl"; data: string }
  | {
      result: "CommandExecuted";
      data: { stdout: string; stderr: string; exit_code: number };
    }
  | { result: "CopiedToClipboard"; data: string }
  | { result: "Manual"; data: string };

export interface EnvironmentIssue {
  severity: IssueSeverity;
  provider_id: string;
  issue_type: IssueType;
  description: string;
  current_value?: string | null;
  expected_value?: string | null;
  fixes: FixAction[];
}

export interface ProviderStatus {
  provider_id: string;
  installed: boolean;
  version?: string | null;
  path?: string | null;
}

export interface EnvironmentCheckResult {
  is_ready: boolean;
  providers: ProviderStatus[];
  issues: EnvironmentIssue[];
  checked_at: string;
}

export async function runEnvironmentCheck(
  providerIds?: string[]
): Promise<EnvironmentCheckResult> {
  return await invoke<EnvironmentCheckResult>(
    "run_environment_check",
    providerIds ? { providerIds } : {}
  );
}

export async function applyFix(action: FixAction): Promise<FixResult> {
  return await invoke<FixResult>("apply_fix", { action });
}
