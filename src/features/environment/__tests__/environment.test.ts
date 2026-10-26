import { describe, expect, it } from "vitest";

import {
  createEnvironmentCheckSnapshot,
  getEnvironmentCheckSnapshotResult,
  matchesEnvironmentCheckSnapshot,
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
