import { describe, expect, it } from "vitest";

import {
  createDiagnosticsIndexExportPlan,
  createExecutionHistoryExportPlan,
} from "@/features/history/diagnosticsExportPayload";
import type { ExecutionRecord } from "@/lib/store/types";

function createExecutionRecord(
  overrides: Partial<ExecutionRecord> = {}
): ExecutionRecord {
  return {
    id: "record-1",
    repoId: "repo-1",
    providerId: "dotnet",
    projectPath: "/repo/App.csproj",
    startedAt: "2026-06-03T01:00:00.000Z",
    finishedAt: "2026-06-03T01:01:00.000Z",
    success: false,
    cancelled: false,
    outputDir: "/repo/bin/Release/publish",
    error: "build failed",
    commandLine: "$ dotnet publish /repo/App.csproj",
    snapshotPath: "/repo/snapshot.md",
    failureSignature: "dotnet:build failed",
    outputExcerpt: "Build failed.",
    spec: null,
    fileCount: 0,
    ...overrides,
  };
}

describe("diagnostics export payload", () => {
  it("creates an execution history export plan with sanitized row shape", () => {
    const plan = createExecutionHistoryExportPlan({
      records: [
        createExecutionRecord({
          repoId: undefined,
          outputDir: undefined,
          error: undefined,
          commandLine: undefined,
          snapshotPath: undefined,
          failureSignature: undefined,
        }),
      ],
      format: "json",
      filePrefix: "filtered-history",
      selectedRepoPath: "C:\\workspace\\repo",
      now: new Date("2026-06-03T04:05:06.789Z"),
    });

    expect(plan.defaultPath).toBe(
      "C:\\workspace\\repo\\filtered-history-2026-06-03T04-05-06.789Z.json"
    );
    expect(plan.filters).toEqual([{ name: "JSON", extensions: ["json"] }]);
    expect(plan.history).toEqual([
      {
        id: "record-1",
        repoId: null,
        providerId: "dotnet",
        projectPath: "/repo/App.csproj",
        startedAt: "2026-06-03T01:00:00.000Z",
        finishedAt: "2026-06-03T01:01:00.000Z",
        success: false,
        cancelled: false,
        outputDir: null,
        error: null,
        commandLine: null,
        snapshotPath: null,
        failureSignature: null,
        fileCount: 0,
      },
    ]);
  });

  it("creates a diagnostics index plan from scoped history and export links", () => {
    const scopedRecord = createExecutionRecord({ id: "scoped" });
    const filteredRecord = createExecutionRecord({ id: "filtered" });

    const plan = createDiagnosticsIndexExportPlan({
      scopedExecutionHistory: [scopedRecord, filteredRecord],
      filteredExecutionHistory: [filteredRecord],
      failureGroupCount: 3,
      snapshotPaths: ["/repo/snapshot-a.md", "/repo/snapshot-b.md"],
      recentHistoryExports: ["/repo/history.csv"],
      selectedRepoPath: "/repo",
      now: new Date("2026-06-03T04:05:06.789Z"),
    });

    expect(plan.defaultPath).toBe(
      "/repo/diagnostics-index-2026-06-03T04-05-06.789Z.md"
    );
    expect(plan.payload).toEqual({
      generatedAt: "2026-06-03T04:05:06.789Z",
      summary: {
        historyCount: 2,
        filteredHistoryCount: 1,
        failureGroupCount: 3,
        snapshotCount: 2,
        historyExportCount: 1,
      },
      links: {
        snapshots: ["/repo/snapshot-a.md", "/repo/snapshot-b.md"],
        historyExports: ["/repo/history.csv"],
      },
    });
  });
});
