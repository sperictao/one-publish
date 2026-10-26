import { invoke } from "@tauri-apps/api/core";
import type {
  EnvironmentCheckResult,
  EnvironmentIssue,
  FixAction,
  FixResult,
  IssueSeverity,
} from "@/generated/tauri-contracts";

export type {
  EnvironmentCheckResult,
  EnvironmentIssue,
  FixAction,
  FixResult,
  IssueSeverity,
};

export interface EnvironmentCheckSnapshot {
  providerIds: string[];
  result: EnvironmentCheckResult;
}

// 空偏好表示使用实时 Provider catalog，不预设某一种技术栈。
export const DEFAULT_ENVIRONMENT_PROVIDER_IDS: string[] = [];

function normalizeProviderIds(providerIds?: string[]) {
  return Array.from(
    new Set(
      (providerIds || []).flatMap((id) => {
        const normalizedId = id.trim();
        return normalizedId ? [normalizedId] : [];
      })
    )
  ).sort();
}

export function normalizeEnvironmentProviderIds(providerIds?: string[]) {
  const normalizedProviderIds = normalizeProviderIds(providerIds);
  return normalizedProviderIds.length > 0
    ? normalizedProviderIds
    : DEFAULT_ENVIRONMENT_PROVIDER_IDS;
}

function filterEnvironmentResultByProviderIds(
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
      filterEnvironmentResultByProviderIds(result, normalizedProviderIds) ??
      result,
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
  return (
    snapshot.providerIds.length === normalizedProviderIds.length &&
    snapshot.providerIds.every(
      (providerId, index) => providerId === normalizedProviderIds[index]
    )
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

  if (
    providerIds === undefined ||
    matchesEnvironmentCheckSnapshot(snapshot, providerIds)
  ) {
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
