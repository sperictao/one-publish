import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import {
  applyFix,
  createEnvironmentCheckSnapshot,
  DEFAULT_ENVIRONMENT_PROVIDER_IDS,
  getEnvironmentCheckSnapshotResult,
  matchesEnvironmentCheckSnapshot,
  normalizeEnvironmentProviderIds,
  runEnvironmentCheck,
  scopeEnvironmentCheckSnapshot,
} from "@/features/environment/environment";
import type {
  EnvironmentCheckResult,
  EnvironmentIssue,
} from "@/features/environment/environment";
import type { ProviderStatus } from "@/generated/tauri-contracts";

function provider(providerId: string, installed = true): ProviderStatus {
  return { provider_id: providerId, installed, version: null, path: null };
}

function issue(
  providerId: string,
  severity: EnvironmentIssue["severity"]
): EnvironmentIssue {
  return {
    severity,
    provider_id: providerId,
    issue_type: "missing_tool",
    description: `${providerId} issue`,
    current_value: null,
    expected_value: null,
    fixes: [],
  };
}

function result(overrides: Partial<EnvironmentCheckResult> = {}) {
  return {
    is_ready: true,
    providers: [provider("dotnet"), provider("cargo")],
    issues: [],
    checked_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("createEnvironmentCheckSnapshot", () => {
  it("filters providers and issues to the normalized id set", () => {
    const snapshot = createEnvironmentCheckSnapshot(
      result({ issues: [issue("dotnet", "warning"), issue("cargo", "info")] }),
      [" cargo ", "dotnet", "dotnet"]
    );

    expect(snapshot.providerIds).toEqual(["cargo", "dotnet"]);
    expect(snapshot.result.providers.map((p) => p.provider_id)).toEqual([
      "dotnet",
      "cargo",
    ]);
    expect(snapshot.result.issues).toHaveLength(2);
  });

  it("recomputes is_ready from the scoped view", () => {
    const snapshot = createEnvironmentCheckSnapshot(
      result({
        providers: [provider("dotnet"), provider("cargo", false)],
        issues: [issue("cargo", "critical")],
      }),
      ["dotnet"]
    );

    expect(snapshot.result.is_ready).toBe(true);
    expect(snapshot.result.providers).toHaveLength(1);
    expect(snapshot.result.issues).toHaveLength(0);
  });

  it("keeps the full result when no providers match the scope", () => {
    const full = result();
    const snapshot = createEnvironmentCheckSnapshot(full, ["rust"]);

    expect(snapshot.providerIds).toEqual(["rust"]);
    expect(snapshot.result).toBe(full);
  });
});

describe("normalizeEnvironmentProviderIds", () => {
  afterEach(() => {
    // 旧实现把模块级常量本体作为空偏好结果返回；清理变异写入，避免污染同文件后续用例。
    DEFAULT_ENVIRONMENT_PROVIDER_IDS.length = 0;
  });

  it("returns a fresh array for empty preferences instead of aliasing the shared default", () => {
    const fromEmptyList = normalizeEnvironmentProviderIds([]);
    const fromBlankList = normalizeEnvironmentProviderIds([" ", ""]);
    const fromUndefined = normalizeEnvironmentProviderIds();

    expect(fromEmptyList).toEqual([]);
    expect(fromBlankList).toEqual([]);
    expect(fromUndefined).toEqual([]);
    expect(fromEmptyList).not.toBe(DEFAULT_ENVIRONMENT_PROVIDER_IDS);
    expect(fromEmptyList).not.toBe(fromBlankList);
    expect(fromBlankList).not.toBe(fromUndefined);
  });

  it("does not let a caller's in-place edit corrupt the global default", () => {
    const normalized = normalizeEnvironmentProviderIds([]);
    normalized.push("dotnet");

    expect(DEFAULT_ENVIRONMENT_PROVIDER_IDS).toEqual([]);
    expect(normalizeEnvironmentProviderIds()).toEqual([]);
  });

  it("keeps empty-scope snapshots independent of the shared default", () => {
    const snapshot = createEnvironmentCheckSnapshot(result());
    snapshot.providerIds.push("cargo");

    expect(DEFAULT_ENVIRONMENT_PROVIDER_IDS).toEqual([]);
    expect(createEnvironmentCheckSnapshot(result()).providerIds).toEqual([]);
  });

  it("still trims, deduplicates and sorts non-empty preferences", () => {
    expect(
      normalizeEnvironmentProviderIds([" dotnet ", "cargo", "dotnet", " "])
    ).toEqual(["cargo", "dotnet"]);
  });
});

describe("matchesEnvironmentCheckSnapshot", () => {
  it("matches only the identical normalized id list", () => {
    const snapshot = createEnvironmentCheckSnapshot(result(), [
      "cargo",
      "dotnet",
    ]);

    expect(matchesEnvironmentCheckSnapshot(snapshot, ["dotnet", "cargo"])).toBe(
      true
    );
    expect(matchesEnvironmentCheckSnapshot(snapshot, ["dotnet"])).toBe(false);
    expect(matchesEnvironmentCheckSnapshot(snapshot)).toBe(false);
    expect(matchesEnvironmentCheckSnapshot(null, ["dotnet"])).toBe(false);
  });
});

describe("getEnvironmentCheckSnapshotResult", () => {
  it("returns the stored result unfiltered when ids normalize to empty", () => {
    const snapshot = createEnvironmentCheckSnapshot(result(), [
      "cargo",
      "dotnet",
    ]);

    expect(getEnvironmentCheckSnapshotResult(snapshot, [" ", ""])).toBe(
      snapshot.result
    );
  });

  it("returns the stored result unfiltered when no ids are given", () => {
    const snapshot = createEnvironmentCheckSnapshot(result(), ["dotnet"]);

    expect(getEnvironmentCheckSnapshotResult(snapshot)).toBe(snapshot.result);
    expect(getEnvironmentCheckSnapshotResult(snapshot)?.providers).toHaveLength(
      1
    );
    expect(getEnvironmentCheckSnapshotResult(null)).toBeNull();
  });

  it("refilters the stored result for a narrower scope", () => {
    const snapshot = createEnvironmentCheckSnapshot(result(), [
      "cargo",
      "dotnet",
    ]);

    const scoped = getEnvironmentCheckSnapshotResult(snapshot, ["cargo"]);
    expect(scoped?.providers.map((p) => p.provider_id)).toEqual(["cargo"]);
  });
});

describe("scopeEnvironmentCheckSnapshot", () => {
  it("returns the snapshot unchanged for the same scope", () => {
    const snapshot = createEnvironmentCheckSnapshot(result(), ["dotnet"]);
    expect(scopeEnvironmentCheckSnapshot(snapshot, ["dotnet"])).toBe(snapshot);
    expect(scopeEnvironmentCheckSnapshot(snapshot)).toBe(snapshot);
    expect(scopeEnvironmentCheckSnapshot(null, ["dotnet"])).toBeNull();
  });

  it("builds a narrowed snapshot when the scope differs", () => {
    const snapshot = createEnvironmentCheckSnapshot(result(), [
      "cargo",
      "dotnet",
    ]);

    const narrowed = scopeEnvironmentCheckSnapshot(snapshot, ["dotnet"]);
    expect(narrowed?.providerIds).toEqual(["dotnet"]);
    expect(narrowed?.result.providers.map((p) => p.provider_id)).toEqual([
      "dotnet",
    ]);
  });

  it("returns null when the narrower scope matches nothing", () => {
    const snapshot = createEnvironmentCheckSnapshot(result(), [
      "cargo",
      "dotnet",
    ]);

    expect(scopeEnvironmentCheckSnapshot(snapshot, ["rust"])).toBeNull();
  });
});

describe("invoke wrappers", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("runs the environment check for the full scope by default", async () => {
    const full = result();
    invokeMock.mockResolvedValueOnce(full);

    await expect(runEnvironmentCheck()).resolves.toBe(full);
    expect(invokeMock).toHaveBeenCalledWith("run_environment_check", {});
  });

  it("passes the requested provider scope through to the backend", async () => {
    invokeMock.mockResolvedValueOnce(result());

    await runEnvironmentCheck(["cargo"]);
    expect(invokeMock).toHaveBeenCalledWith("run_environment_check", {
      providerIds: ["cargo"],
    });
  });

  it("applies a fix action through the backend contract", async () => {
    const action = {
      action_type: "open_url" as const,
      label: "Install",
      command: null,
      url: "https://example.com",
    };
    const fixResult = {
      result: "OpenedUrl" as const,
      data: "https://example.com",
    };
    invokeMock.mockResolvedValueOnce(fixResult);

    await expect(applyFix(action)).resolves.toBe(fixResult);
    expect(invokeMock).toHaveBeenCalledWith("apply_fix", { action });
  });
});
