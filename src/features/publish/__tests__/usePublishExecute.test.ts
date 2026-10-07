import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PublishFailedEvent } from "@/features/publish/publishEvents";
import type { UsePublishValidateResult } from "@/features/publish/usePublishValidate";
import en from "@/i18n/en.json";
import zh from "@/i18n/zh.json";
import { on } from "@/lib/eventBus";

const mocks = vi.hoisted(() => ({
  i18n: { translations: {} as Record<string, unknown> },
  preparePublishRuntime: vi.fn(),
  resumePublishRuntime: vi.fn(),
  synchronizePublishRuntime: vi.fn(),
  exportExecutionSnapshot: vi.fn(),
  toast: { error: vi.fn(), message: vi.fn(), success: vi.fn() },
}));

vi.mock("@/hooks/useI18n", () => ({
  useI18n: () => ({ translations: mocks.i18n.translations }),
}));

vi.mock("sonner", () => ({ toast: mocks.toast }));

vi.mock("@/features/history/executionSnapshot", () => ({
  exportExecutionSnapshot: mocks.exportExecutionSnapshot,
}));

vi.mock("@/features/publish/publishRuntime", async () => ({
  ...(await vi.importActual<typeof import("@/features/publish/publishRuntime")>(
    "@/features/publish/publishRuntime"
  )),
  preparePublishRuntime: mocks.preparePublishRuntime,
  resumePublishRuntime: mocks.resumePublishRuntime,
  synchronizePublishRuntime: mocks.synchronizePublishRuntime,
}));

import { usePublishExecute } from "@/features/publish/usePublishExecute";
import { usePublishStore } from "@/stores/publishStore";

// 后端 message 恒为英文/中文技术文案；界面语言决定 `errors.<code>` 取哪份文案。
const repositoryUnavailable = {
  kind: "repository",
  message: "selected repository is not a directory",
  details: "/repo",
  code: "publish_runtime_repository_unavailable",
};

// 稳定引用：usePublishExecute 的回调依赖 validate 对象本身。
const validate = {
  getPublishStartBlocker: () => null,
  resolvePublishRequest: vi.fn(),
  runPublishPreflight: vi.fn(),
  requestRuntimeOutputAccess: vi.fn(),
  publishPreviewCommand: "",
  preparedRuntime: null,
  runtimePreparationError: null,
  isResolvingSelectedProjectProfile: false,
  publishPresentationScopeKey: "scope",
} as unknown as UsePublishValidateResult;

const params = {
  appT: {},
  publishT: {},
  selectedRepoId: "repo-1",
  selectedRepoPath: "/repo",
  pushRecentConfig: vi.fn(),
  beginLogCapture: vi.fn(),
  hideLogCapture: vi.fn(),
  getOutputLogSnapshot: () => "",
  replaceCapturedOutputLog: vi.fn(),
  validate,
  currentConfigurationRevisionId: "revision-1",
};

describe("usePublishExecute invoke 失败本地化", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.i18n.translations = en;
    mocks.exportExecutionSnapshot.mockResolvedValue(null);
    usePublishStore.getState().setIsPublishing(false);
  });

  afterEach(() => {
    usePublishStore.getState().setIsPublishing(false);
  });

  it("恢复发布状态失败按界面语言提示，翻译切换不重跑恢复 effect", async () => {
    mocks.synchronizePublishRuntime.mockRejectedValue(repositoryUnavailable);

    const { rerender } = renderHook(() => usePublishExecute(params));

    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("恢复发布状态失败", {
        description:
          "Couldn't resolve the selected repository path. Make sure the repository directory exists. | /repo",
      })
    );

    mocks.i18n.translations = zh;
    rerender();
    await act(async () => {});

    expect(mocks.synchronizePublishRuntime).toHaveBeenCalledTimes(1);
  });

  it("继续发布失败按界面语言提示", async () => {
    mocks.synchronizePublishRuntime.mockResolvedValue({
      result: { attempt: { status: "running", attemptId: "attempt-1" } },
    });
    mocks.resumePublishRuntime.mockRejectedValue(repositoryUnavailable);

    const { result } = renderHook(() => usePublishExecute(params));
    await waitFor(() =>
      expect(result.current.runtimeResult?.attempt.status).toBe("running")
    );

    await act(async () => {
      await result.current.startPublish();
    });

    expect(mocks.resumePublishRuntime).toHaveBeenCalledWith({
      attemptId: "attempt-1",
    });
    expect(mocks.toast.error).toHaveBeenCalledWith("继续发布失败", {
      description:
        "Couldn't resolve the selected repository path. Make sure the repository directory exists. | /repo",
    });
  });

  it("发布准备失败：反馈本地化，事件与历史保留后端原文", async () => {
    mocks.synchronizePublishRuntime.mockResolvedValue({ result: null });
    mocks.preparePublishRuntime.mockRejectedValue({
      kind: "validation",
      message: "failed to resolve publish project",
      details: "/repo/App.csproj: No such file or directory (os error 2)",
      code: "publish_runtime_project_unavailable",
    });
    const failed: PublishFailedEvent[] = [];
    const unsubscribe = on<PublishFailedEvent>("publish:failed", (event) => {
      failed.push(event);
    });

    const { result } = renderHook(() => usePublishExecute(params));

    await act(async () => {
      await result.current.runPublishSpec({
        kind: "empty",
        providerId: "dotnet",
      } as Parameters<typeof result.current.runPublishSpec>[0]);
    });
    unsubscribe();

    expect(failed).toHaveLength(1);
    expect(failed[0].feedbackDescription).toBe(
      "Couldn't resolve the publish project path. Make sure the project file is still in the repository. | /repo/App.csproj: No such file or directory (os error 2)"
    );
    expect(failed[0].error).toBe(
      "failed to resolve publish project | /repo/App.csproj: No such file or directory (os error 2)"
    );
    expect(failed[0].record.error).toBe(failed[0].error);
  });
});
