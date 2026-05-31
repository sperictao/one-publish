import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ExecutionHistoryCard } from "@/components/publish/ExecutionHistoryCard";
import type { ExecutionRecord } from "@/lib/store/types";

function createRecord(overrides?: Partial<ExecutionRecord>): ExecutionRecord {
  return {
    id: "record-1",
    repoId: "repo-1",
    providerId: "dotnet",
    projectPath: "/repo/App.csproj",
    startedAt: "2026-04-02T10:00:00.000Z",
    finishedAt: "2026-04-02T10:00:03.000Z",
    success: false,
    cancelled: false,
    outputDir: null,
    error: "MSBuild failed: missing SDK",
    commandLine: "$ dotnet publish /repo/App.csproj",
    snapshotPath: null,
    failureSignature: "msbuild failed: missing sdk",
    spec: null,
    fileCount: 0,
    ...overrides,
  };
}

describe("ExecutionHistoryCard", () => {
  it("为失败记录展示失败原因", () => {
    const record = createRecord();

    render(
      <ExecutionHistoryCard
        scopedExecutionHistory={[record]}
        filteredExecutionHistory={[record]}
        executionHistoryLimit={20}
        historyProviderOptions={["dotnet"]}
        historyFilterProvider="all"
        historyFilterStatus="all"
        historyFilterWindow="all"
        historyFilterKeyword=""
        isExportingHistory={false}
        isPublishing={false}
        appT={{
          statusSuccess: "成功",
          statusFailed: "失败",
          statusCancelled: "已取消",
        }}
        historyT={{
          title: "最近执行历史",
          failureReason: "失败原因",
          completedAt: "完成时间",
          rerun: "重新执行",
        }}
        failureT={{
          openSnapshot: "打开快照",
        }}
        onHistoryFilterProviderChange={vi.fn()}
        onHistoryFilterStatusChange={vi.fn()}
        onHistoryFilterWindowChange={vi.fn()}
        onHistoryFilterKeywordChange={vi.fn()}
        onExportExecutionHistory={vi.fn(async () => undefined)}
        onClearFilters={vi.fn()}
        onOpenSnapshotFromRecord={vi.fn(async () => undefined)}
        onRerunFromHistory={vi.fn(async () => undefined)}
        onCopyHandoffSnippet={vi.fn(async () => undefined)}
      />
    );

    expect(screen.getByText("失败原因:")).toBeInTheDocument();
    expect(screen.getByText("MSBuild failed: missing SDK")).toBeInTheDocument();
  });

  it("成功记录只保留 Shell 交接片段入口", () => {
    const record = createRecord({
      success: true,
      error: null,
      failureSignature: null,
    });

    render(
      <ExecutionHistoryCard
        scopedExecutionHistory={[record]}
        filteredExecutionHistory={[record]}
        executionHistoryLimit={20}
        historyProviderOptions={["dotnet"]}
        historyFilterProvider="all"
        historyFilterStatus="all"
        historyFilterWindow="all"
        historyFilterKeyword=""
        isExportingHistory={false}
        isPublishing={false}
        appT={{
          statusSuccess: "成功",
          statusFailed: "失败",
          statusCancelled: "已取消",
        }}
        historyT={{
          title: "最近执行历史",
          rerun: "重新执行",
          copyShellSnippet: "复制 Shell 片段",
          copyGhaSnippet: "复制 GHA 片段",
          exportHistory: "导出历史",
        }}
        failureT={{
          openSnapshot: "打开快照",
        }}
        onHistoryFilterProviderChange={vi.fn()}
        onHistoryFilterStatusChange={vi.fn()}
        onHistoryFilterWindowChange={vi.fn()}
        onHistoryFilterKeywordChange={vi.fn()}
        onExportExecutionHistory={vi.fn(async () => undefined)}
        onClearFilters={vi.fn()}
        onOpenSnapshotFromRecord={vi.fn(async () => undefined)}
        onRerunFromHistory={vi.fn(async () => undefined)}
        onCopyHandoffSnippet={vi.fn(async () => undefined)}
      />
    );

    expect(screen.getByRole("button", { name: "复制 Shell 片段" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "复制 GHA 片段" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "导出诊断索引" })).not.toBeInTheDocument();
  });
});
