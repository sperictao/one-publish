import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import {
  buildExecutionSnapshotPayload,
  exportExecutionSnapshot,
} from "@/features/history/executionSnapshot";
import type { ExecutionRecord } from "@/lib/store/types";

function createRecord(
  overrides: Partial<ExecutionRecord> = {}
): ExecutionRecord {
  return {
    id: "record-1",
    repoId: "repo-1",
    providerId: "dotnet",
    projectPath: "/repo/App.csproj",
    startedAt: "2026-07-17T10:00:00.000Z",
    finishedAt: "2026-07-17T10:01:02.345Z",
    success: true,
    cancelled: false,
    outputDir: "/exports/App/Release",
    error: null,
    commandLine: '$ dotnet publish "/repo/App.csproj"',
    snapshotPath: null,
    failureSignature: null,
    outputExcerpt: null,
    spec: { provider_id: "dotnet" },
    fileCount: 3,
    warnings: null,
    ...overrides,
  };
}

describe("executionSnapshot", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("payload 包含渲染所需的核心字段", () => {
    const payload = buildExecutionSnapshotPayload(
      createRecord(),
      "$ dotnet publish\nBuild succeeded."
    );

    expect(payload).toEqual({
      generatedAt: "2026-07-17T10:01:02.345Z",
      providerId: "dotnet",
      spec: { provider_id: "dotnet" },
      command: { line: '$ dotnet publish "/repo/App.csproj"' },
      result: {
        success: true,
        cancelled: false,
        error: null,
        outputDir: "/exports/App/Release",
        fileCount: 3,
      },
      output: {
        log: "$ dotnet publish\nBuild succeeded.",
      },
    });
  });

  it("交由后端写入私有存储区，不把快照路径指向输出目录", async () => {
    const storedPath =
      "/Users/me/.one-publish/execution-snapshots/abc/execution-snapshot-2026-07-17T10-01-02.345Z.md";
    invokeMock.mockResolvedValue(storedPath);

    const record = createRecord();
    const path = await exportExecutionSnapshot(record, "log");

    expect(path).toBe(storedPath);
    expect(invokeMock).toHaveBeenCalledWith("export_execution_snapshot", {
      outputDir: "/exports/App/Release",
      snapshot: buildExecutionSnapshotPayload(record, "log"),
    });
  });

  it("记录没有输出目录时跳过导出", async () => {
    const path = await exportExecutionSnapshot(
      createRecord({ outputDir: null }),
      "log"
    );

    expect(path).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("导出失败时降级为 null 而不中断发布流程", async () => {
    invokeMock.mockRejectedValue(new Error("disk full"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const path = await exportExecutionSnapshot(createRecord(), "log");

    expect(path).toBeNull();
    warnSpy.mockRestore();
  });
});
