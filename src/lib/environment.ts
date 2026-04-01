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

export interface EnvironmentCheckSnapshot {
  providerIds: string[];
  result: EnvironmentCheckResult;
}

export const DEFAULT_ENVIRONMENT_PROVIDER_IDS = ["dotnet"];

function normalizeProviderIds(providerIds?: string[]) {
  return Array.from(
    new Set((providerIds || []).map((id) => id.trim()).filter(Boolean))
  ).sort();
}

export function normalizeEnvironmentProviderIds(providerIds?: string[]) {
  const normalizedProviderIds = normalizeProviderIds(providerIds);
  return normalizedProviderIds.length > 0
    ? normalizedProviderIds
    : DEFAULT_ENVIRONMENT_PROVIDER_IDS;
}

export function filterEnvironmentResultByProviderIds(
  result: EnvironmentCheckResult | null | undefined,
  providerIds?: string[]
): EnvironmentCheckResult | null {
  if (!result) {
    return null;
  }

  const normalizedProviderIds = normalizeProviderIds(providerIds);
  if (normalizedProviderIds.length === 0) {
    return result;
  }

  const providerIdSet = new Set(normalizedProviderIds);
  const providers = result.providers.filter((provider) =>
    providerIdSet.has(provider.provider_id)
  );
  const issues = result.issues.filter((issue) =>
    providerIdSet.has(issue.provider_id)
  );

  if (providers.length === 0 && issues.length === 0) {
    return null;
  }

  return {
    ...result,
    providers,
    issues,
    is_ready:
      providers.every((provider) => provider.installed) &&
      issues.every((issue) => issue.severity !== "critical"),
  };
}

export function createEnvironmentCheckSnapshot(
  result: EnvironmentCheckResult,
  providerIds?: string[]
): EnvironmentCheckSnapshot {
  const normalizedProviderIds = normalizeEnvironmentProviderIds(providerIds);

  return {
    providerIds: normalizedProviderIds,
    result:
      filterEnvironmentResultByProviderIds(result, normalizedProviderIds) ?? result,
  };
}

export function matchesEnvironmentCheckSnapshot(
  snapshot: EnvironmentCheckSnapshot | null | undefined,
  providerIds?: string[]
): boolean {
  if (!snapshot) {
    return false;
  }

  const normalizedProviderIds = normalizeEnvironmentProviderIds(providerIds);
  if (snapshot.providerIds.length !== normalizedProviderIds.length) {
    return false;
  }

  return snapshot.providerIds.every(
    (providerId, index) => providerId === normalizedProviderIds[index]
  );
}

export function getEnvironmentCheckSnapshotResult(
  snapshot: EnvironmentCheckSnapshot | null | undefined,
  providerIds?: string[]
): EnvironmentCheckResult | null {
  if (!snapshot) {
    return null;
  }

  if (providerIds === undefined) {
    return snapshot.result;
  }

  return filterEnvironmentResultByProviderIds(snapshot.result, providerIds);
}

export function scopeEnvironmentCheckSnapshot(
  snapshot: EnvironmentCheckSnapshot | null | undefined,
  providerIds?: string[]
): EnvironmentCheckSnapshot | null {
  if (!snapshot) {
    return null;
  }

  if (providerIds === undefined || matchesEnvironmentCheckSnapshot(snapshot, providerIds)) {
    return snapshot;
  }

  const scopedResult = getEnvironmentCheckSnapshotResult(snapshot, providerIds);
  if (!scopedResult) {
    return null;
  }

  return createEnvironmentCheckSnapshot(scopedResult, providerIds);
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
