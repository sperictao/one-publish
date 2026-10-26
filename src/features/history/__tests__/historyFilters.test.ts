import { describe, expect, it } from "vitest";

import {
  filterExecutionHistory,
  isRecordInRepository,
} from "@/features/history/utils/historyFilters";
import type { ExecutionRecord, Repository } from "@/lib/store/types";

function record(overrides: Partial<ExecutionRecord> = {}): ExecutionRecord {
  return {
    id: "rec-1",
    providerId: "dotnet",
    projectPath: "/repo/app",
    startedAt: "2026-01-01T00:00:00Z",
    finishedAt: "2026-01-01T00:00:01Z",
    success: true,
    cancelled: false,
    fileCount: 1,
    repoId: "repo-1",
    ...overrides,
  };
}

const NO_FILTER = {
  provider: "all",
  status: "all" as const,
  window: "all" as const,
  keyword: "",
};

describe("filterExecutionHistory", () => {
  const records = [
    record({ id: "a", providerId: "dotnet", success: true }),
    record({ id: "b", providerId: "cargo", success: false, cancelled: false }),
    record({
      id: "c",
      providerId: "dotnet",
      success: false,
      cancelled: true,
    }),
  ];

  it("returns everything under the default filter", () => {
    expect(filterExecutionHistory(records, NO_FILTER).map((r) => r.id)).toEqual(
      ["a", "b", "c"]
    );
  });

  it("filters by provider", () => {
    const filtered = filterExecutionHistory(records, {
      ...NO_FILTER,
      provider: "cargo",
    });
    expect(filtered.map((r) => r.id)).toEqual(["b"]);
  });

  it("filters by status — success/failed/cancelled are exclusive", () => {
    expect(
      filterExecutionHistory(records, {
        ...NO_FILTER,
        status: "success",
      }).map((r) => r.id)
    ).toEqual(["a"]);
    expect(
      filterExecutionHistory(records, {
        ...NO_FILTER,
        status: "failed",
      }).map((r) => r.id)
    ).toEqual(["b"]);
    expect(
      filterExecutionHistory(records, {
        ...NO_FILTER,
        status: "cancelled",
      }).map((r) => r.id)
    ).toEqual(["c"]);
  });

  it("drops records outside the time window or with unparseable timestamps", () => {
    const now = Date.parse("2026-02-01T00:00:00Z");
    const rows = [
      record({ id: "fresh", finishedAt: "2026-01-31T12:00:00Z" }),
      record({ id: "stale", finishedAt: "2026-01-01T00:00:00Z" }),
      record({ id: "broken", finishedAt: "not-a-date" }),
    ];

    expect(
      filterExecutionHistory(rows, { ...NO_FILTER, window: "7d" }, now).map(
        (r) => r.id
      )
    ).toEqual(["fresh"]);
  });

  it("keeps records at the exact window boundary", () => {
    const now = Date.parse("2026-02-01T00:00:00Z");
    const boundary = new Date(now - 24 * 60 * 60 * 1000).toISOString();

    expect(
      filterExecutionHistory(
        [record({ finishedAt: boundary })],
        { ...NO_FILTER, window: "24h" },
        now
      )
    ).toHaveLength(1);
  });

  it("matches keyword case-insensitively across searchable fields", () => {
    const rows = [
      record({ id: "1", error: "NU1101 package restore FAILED" }),
      record({ id: "2", commandLine: "dotnet publish -c Release" }),
      record({ id: "3", failureSignature: "csproj-missing" }),
      record({ id: "4", outputExcerpt: "writing bundle..." }),
      record({ id: "5" }),
    ];

    const filtered = filterExecutionHistory(rows, {
      ...NO_FILTER,
      keyword: "  PACKAGE  ",
    });
    expect(filtered.map((r) => r.id)).toEqual(["1"]);

    expect(
      filterExecutionHistory(rows, { ...NO_FILTER, keyword: "publish" }).map(
        (r) => r.id
      )
    ).toEqual(["2"]);
    expect(
      filterExecutionHistory(rows, {
        ...NO_FILTER,
        keyword: "csproj-missing",
      }).map((r) => r.id)
    ).toEqual(["3"]);
    expect(
      filterExecutionHistory(rows, { ...NO_FILTER, keyword: "bundle" }).map(
        (r) => r.id
      )
    ).toEqual(["4"]);
  });

  it("combines provider+status+keyword conjunctively", () => {
    const filtered = filterExecutionHistory(records, {
      provider: "dotnet",
      status: "success",
      window: "all",
      keyword: "dotnet",
    });
    expect(filtered.map((r) => r.id)).toEqual(["a"]);
  });
});

describe("isRecordInRepository", () => {
  const repo = { id: "repo-1", path: "/repos/one" } as Repository;

  it("matches by repoId first", () => {
    expect(
      isRecordInRepository(
        record({ repoId: "repo-1", projectPath: "/elsewhere" }),
        repo
      )
    ).toBe(true);
  });

  it("falls back to project-path containment when repoId differs", () => {
    expect(
      isRecordInRepository(
        record({ repoId: "repo-9", projectPath: "/repos/one/app" }),
        repo
      )
    ).toBe(true);
  });

  it("rejects unrelated paths", () => {
    expect(
      isRecordInRepository(
        record({ repoId: "repo-9", projectPath: "/other/app" }),
        repo
      )
    ).toBe(false);
  });
});
