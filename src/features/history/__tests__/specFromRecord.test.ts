import { describe, expect, it } from "vitest";

import { extractSpecFromRecord } from "@/features/history/specFromRecord";
import type { ExecutionRecord } from "@/lib/store/types";

function recordWithSpec(spec: ExecutionRecord["spec"]): ExecutionRecord {
  return {
    id: "rec-1",
    providerId: "dotnet",
    projectPath: "/repo/app",
    startedAt: "2026-01-01T00:00:00Z",
    finishedAt: "2026-01-01T00:00:01Z",
    success: true,
    cancelled: false,
    fileCount: 0,
    repoId: "repo-1",
    spec,
  };
}

describe("extractSpecFromRecord", () => {
  it("returns null when the record carries no spec payload", () => {
    expect(extractSpecFromRecord(recordWithSpec(null))).toBeNull();
    expect(extractSpecFromRecord(recordWithSpec(undefined))).toBeNull();
    expect(extractSpecFromRecord(recordWithSpec("not-an-object"))).toBeNull();
    expect(extractSpecFromRecord(recordWithSpec([1, 2]))).toBeNull();
  });

  it("returns null when provider_id or project_path are missing or non-string", () => {
    expect(
      extractSpecFromRecord(recordWithSpec({ project_path: "/p" }))
    ).toBeNull();
    expect(
      extractSpecFromRecord(recordWithSpec({ provider_id: "dotnet" }))
    ).toBeNull();
    expect(
      extractSpecFromRecord(
        recordWithSpec({ provider_id: 42, project_path: "/p" })
      )
    ).toBeNull();
  });

  it("restores a spec snapshot with defaults for absent version/parameters", () => {
    const restored = extractSpecFromRecord(
      recordWithSpec({ provider_id: "dotnet", project_path: "/repo/app" })
    );

    expect(restored).toEqual({
      version: 1,
      provider_id: "dotnet",
      project_path: "/repo/app",
      parameters: {},
    });
  });

  it("preserves explicit version and object parameters", () => {
    const restored = extractSpecFromRecord(
      recordWithSpec({
        provider_id: "cargo",
        project_path: "/repo/bin",
        version: 3,
        parameters: { release: true, target: "aarch64" },
      })
    );

    expect(restored).toEqual({
      version: 3,
      provider_id: "cargo",
      project_path: "/repo/bin",
      parameters: { release: true, target: "aarch64" },
    });
  });

  it("ignores non-object parameter payloads", () => {
    const restored = extractSpecFromRecord(
      recordWithSpec({
        provider_id: "dotnet",
        project_path: "/repo/app",
        parameters: ["--release"],
      })
    );

    expect(restored?.parameters).toEqual({});
  });
});
