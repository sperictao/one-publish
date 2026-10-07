import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ExecutionRecord } from "@/lib/store/types";

const mocks = vi.hoisted(() => ({
  openExecutionSnapshot: vi.fn(),
  setExecutionSnapshotPath: vi.fn(),
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: mocks.toast,
}));

vi.mock("@/lib/store/api", () => ({
  openExecutionSnapshot: mocks.openExecutionSnapshot,
}));

vi.mock("@/stores/appStore", () => ({
  useAppStore: (
    selector: (state: {
      setExecutionSnapshotPath: typeof mocks.setExecutionSnapshotPath;
    }) => unknown
  ) => selector({ setExecutionSnapshotPath: mocks.setExecutionSnapshotPath }),
}));

// 用真实 zh 文案，顺带校验后端错误码已在 `errors.<code>` 登记。
vi.mock("@/hooks/useI18n", async () => {
  const zh = (await import("@/i18n/zh.json")).default;
  return { useI18n: () => ({ translations: zh }) };
});

import { useHistoryActions } from "@/features/history/useHistoryActions";

const APP_STATE_SNAPSHOT =
  "/home/u/.one-publish/execution-snapshots/abc/execution-snapshot-2026-07-17T10-01-02.345Z.md";

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
    snapshotPath: APP_STATE_SNAPSHOT,
    failureSignature: null,
    outputExcerpt: null,
    spec: null,
    fileCount: 3,
    warnings: null,
    ...overrides,
  };
}

function renderHistoryActions() {
  return renderHook(() =>
    useHistoryActions({
      appT: {},
      historyT: {},
      extractSpecFromRecord: () => null,
    })
  ).result;
}

describe("useHistoryActions.openSnapshotFromRecord", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("打开记录中的快照路径，路径未变化时不回写记录", async () => {
    mocks.openExecutionSnapshot.mockResolvedValue(APP_STATE_SNAPSHOT);
    const result = renderHistoryActions();

    await act(async () => {
      await result.current.openSnapshotFromRecord(createRecord());
    });

    expect(mocks.openExecutionSnapshot).toHaveBeenCalledWith({
      snapshotPath: APP_STATE_SNAPSHOT,
      outputDir: "/exports/App/Release",
    });
    expect(mocks.setExecutionSnapshotPath).not.toHaveBeenCalled();
    expect(mocks.toast.success).toHaveBeenCalledWith("已打开执行快照", {
      description: APP_STATE_SNAPSHOT,
    });
  });

  it("记录缺少快照路径时按输出目录回退，并回写后端解析出的本地状态路径", async () => {
    mocks.openExecutionSnapshot.mockResolvedValue(APP_STATE_SNAPSHOT);
    const result = renderHistoryActions();

    await act(async () => {
      await result.current.openSnapshotFromRecord(
        createRecord({ snapshotPath: null })
      );
    });

    expect(mocks.openExecutionSnapshot).toHaveBeenCalledWith({
      snapshotPath: null,
      outputDir: "/exports/App/Release",
    });
    expect(mocks.setExecutionSnapshotPath).toHaveBeenCalledWith(
      "record-1",
      APP_STATE_SNAPSHOT
    );
  });

  // Tauri invoke 以 AppError 对象 reject，而不是 Error 实例。
  it.each([
    {
      error: {
        kind: "export",
        message: "未找到输出目录的执行快照",
        details: "/exports/App/Release",
        code: "snapshot_not_found_for_output_dir",
      },
      description: "未找到该输出目录的执行快照 | /exports/App/Release",
    },
    {
      error: {
        kind: "external_open",
        message: "打开快照失败",
        details: "No application knows how to open the file",
        code: "open_snapshot_failed",
      },
      description:
        "无法打开执行快照 | No application knows how to open the file",
    },
  ])(
    "打开失败（$error.code）时提示本地化错误且不回写记录",
    async ({ error, description }) => {
      mocks.openExecutionSnapshot.mockRejectedValue(error);
      const result = renderHistoryActions();

      await act(async () => {
        await result.current.openSnapshotFromRecord(
          createRecord({ snapshotPath: null })
        );
      });

      expect(mocks.setExecutionSnapshotPath).not.toHaveBeenCalled();
      expect(mocks.toast.error).toHaveBeenCalledWith("打开执行快照失败", {
        description,
      });
    }
  );
});
