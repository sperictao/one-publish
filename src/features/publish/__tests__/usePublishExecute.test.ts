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
  startPublishRuntime: vi.fn(),
  cancelPublishRuntime: vi.fn(),
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
  startPublishRuntime: mocks.startPublishRuntime,
  cancelPublishRuntime: mocks.cancelPublishRuntime,
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

  it("同步报告缺失段时输出诊断日志", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.synchronizePublishRuntime.mockResolvedValue({
      attemptId: "attempt-9",
      acceptedEvents: 0,
      duplicateEvents: 0,
      missingRanges: [{ start: 2, end: 5 }],
      result: null,
    });

    renderHook(() => usePublishExecute(params));

    await waitFor(() =>
      expect(warnSpy).toHaveBeenCalledWith(
        "publish runtime synchronization reported missing event ranges",
        { attemptId: "attempt-9", missingRanges: [{ start: 2, end: 5 }] }
      )
    );
    warnSpy.mockRestore();
  });

  it("同步报告无缺失段时不输出诊断日志", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.synchronizePublishRuntime.mockResolvedValue({
      attemptId: "attempt-9",
      acceptedEvents: 0,
      duplicateEvents: 0,
      missingRanges: [],
      result: null,
    });

    renderHook(() => usePublishExecute(params));
    await waitFor(() =>
      expect(mocks.synchronizePublishRuntime).toHaveBeenCalled()
    );

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("继续发布失败按界面语言提示", async () => {
    mocks.synchronizePublishRuntime.mockResolvedValue({
      attemptId: "attempt-1",
      acceptedEvents: 0,
      duplicateEvents: 0,
      missingRanges: [],
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
    mocks.synchronizePublishRuntime.mockResolvedValue({
      attemptId: "",
      acceptedEvents: 0,
      duplicateEvents: 0,
      missingRanges: [],
      result: null,
    });
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

  it("再交付把 promotedManifestDigest 注入 prepare 请求 runInputs", async () => {
    mocks.synchronizePublishRuntime.mockResolvedValue({
      attemptId: "",
      acceptedEvents: 0,
      duplicateEvents: 0,
      missingRanges: [],
      result: null,
    });
    mocks.preparePublishRuntime.mockResolvedValue({
      status: "ready",
      runtimeToken: "runtime-1",
      resolvedSpec: { provider_id: "dotnet" },
      command: "dotnet publish",
    });
    // 预检未通过即停在 prepare 之后：digest 断言只看请求载荷本身。
    vi.mocked(validate.runPublishPreflight).mockResolvedValue(false);

    const { result } = renderHook(() => usePublishExecute(params));

    await act(async () => {
      await result.current.runPublishSpec(
        { kind: "history", recordId: "record-1" } as Parameters<
          typeof result.current.runPublishSpec
        >[0],
        { promotedManifestDigest: "digest-abc" }
      );
    });

    expect(mocks.preparePublishRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        source: { kind: "history", recordId: "record-1" },
        runInputs: expect.objectContaining({
          promotedManifestDigest: "digest-abc",
        }),
      })
    );
  });

  it("默认发布不传 promotedManifestDigest", async () => {
    mocks.synchronizePublishRuntime.mockResolvedValue({
      attemptId: "",
      acceptedEvents: 0,
      duplicateEvents: 0,
      missingRanges: [],
      result: null,
    });
    mocks.preparePublishRuntime.mockResolvedValue({
      status: "ready",
      runtimeToken: "runtime-1",
      resolvedSpec: { provider_id: "dotnet" },
      command: "dotnet publish",
    });
    vi.mocked(validate.runPublishPreflight).mockResolvedValue(false);

    const { result } = renderHook(() => usePublishExecute(params));

    await act(async () => {
      await result.current.runPublishSpec({
        kind: "empty",
        providerId: "dotnet",
      } as Parameters<typeof result.current.runPublishSpec>[0]);
    });

    expect(mocks.preparePublishRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        runInputs: expect.objectContaining({
          promotedManifestDigest: undefined,
        }),
      })
    );
  });
});

describe("usePublishExecute 守卫与恢复流", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.i18n.translations = en;
    mocks.exportExecutionSnapshot.mockResolvedValue(null);
    mocks.synchronizePublishRuntime.mockResolvedValue({
      attemptId: "",
      acceptedEvents: 0,
      duplicateEvents: 0,
      missingRanges: [],
      result: null,
    });
    usePublishStore.getState().setIsPublishing(false);
    usePublishStore.getState().setIsCancellingPublish(false);
    validate.getPublishStartBlocker = () => null;
    validate.preparedRuntime = null;
  });

  afterEach(() => {
    usePublishStore.getState().setIsPublishing(false);
    usePublishStore.getState().setIsCancellingPublish(false);
  });

  it("startPublish：缺失仓库时提示先选择仓库", async () => {
    validate.getPublishStartBlocker = () => "missing-repository";

    const { result } = renderHook(() => usePublishExecute(params));
    await act(async () => {
      await result.current.startPublish();
    });

    expect(mocks.toast.error).toHaveBeenCalledWith("请先选择仓库");
    expect(mocks.preparePublishRuntime).not.toHaveBeenCalled();
  });

  it("startPublish：缺失项目绑定时提示先绑定项目", async () => {
    validate.getPublishStartBlocker = () => "missing-project";

    const { result } = renderHook(() => usePublishExecute(params));
    await act(async () => {
      await result.current.startPublish();
    });

    expect(mocks.toast.error).toHaveBeenCalledWith("请先在仓库设置中绑定项目");
  });

  it("startPublish：runtime 阻塞时提示配置不可执行", async () => {
    validate.getPublishStartBlocker = () => "runtime-blocked";
    validate.preparedRuntime = null;

    const { result } = renderHook(() => usePublishExecute(params));
    await act(async () => {
      await result.current.startPublish();
    });

    expect(mocks.toast.error).toHaveBeenCalledWith("当前发布配置不可执行", {
      description: "本地发布计划存在阻塞项",
    });
  });

  it("startPublish：请求解析为空时不进入准备", async () => {
    vi.mocked(validate.resolvePublishRequest).mockResolvedValue(null);

    const { result } = renderHook(() => usePublishExecute(params));
    await act(async () => {
      await result.current.startPublish();
    });

    expect(mocks.preparePublishRuntime).not.toHaveBeenCalled();
  });

  it("startPublish：解析出的请求进入发布流程", async () => {
    const source = { kind: "empty", providerId: "dotnet" };
    vi.mocked(validate.resolvePublishRequest).mockResolvedValue({
      source,
    } as never);
    mocks.preparePublishRuntime.mockResolvedValue({
      status: "ready",
      runtimeToken: "rt",
      resolvedSpec: { provider_id: "dotnet" },
      command: "dotnet publish",
    });
    vi.mocked(validate.runPublishPreflight).mockResolvedValue(false);

    const { result } = renderHook(() => usePublishExecute(params));
    await act(async () => {
      await result.current.startPublish();
    });

    expect(mocks.preparePublishRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ source })
    );
  });

  it("输出授权获批后二次准备并继续流程", async () => {
    mocks.preparePublishRuntime
      .mockResolvedValueOnce({
        status: "blocked",
        outputPreflight: { accessStatus: "denied" },
        diagnostics: [
          { code: "publish_output_access_denied", message: "denied" },
        ],
      })
      .mockResolvedValueOnce({
        status: "ready",
        runtimeToken: "rt",
        resolvedSpec: { provider_id: "dotnet" },
        command: "dotnet publish",
      });
    vi.mocked(validate.requestRuntimeOutputAccess).mockResolvedValue(true);
    vi.mocked(validate.runPublishPreflight).mockResolvedValue(false);

    const { result } = renderHook(() => usePublishExecute(params));
    await act(async () => {
      await result.current.runPublishSpec({
        kind: "empty",
        providerId: "dotnet",
      } as Parameters<typeof result.current.runPublishSpec>[0]);
    });

    expect(validate.requestRuntimeOutputAccess).toHaveBeenCalled();
    expect(mocks.preparePublishRuntime).toHaveBeenCalledTimes(2);
  });

  it("resume 返回运行中 attempt 时重绑活动 run", async () => {
    mocks.synchronizePublishRuntime.mockResolvedValue({
      attemptId: "attempt-1",
      acceptedEvents: 0,
      duplicateEvents: 0,
      missingRanges: [],
      result: { attempt: { status: "running", attemptId: "attempt-1" } },
    });
    mocks.resumePublishRuntime.mockResolvedValue({
      attempt: { status: "running", attemptId: "attempt-2" },
    });

    const { result } = renderHook(() => usePublishExecute(params));
    await waitFor(() =>
      expect(result.current.runtimeResult?.attempt.status).toBe("running")
    );

    await act(async () => {
      await result.current.startPublish();
    });

    await waitFor(() =>
      expect(result.current.runtimeResult?.attempt.attemptId).toBe("attempt-2")
    );
    expect(mocks.resumePublishRuntime).toHaveBeenCalledWith({
      attemptId: "attempt-1",
    });
  });

  it("cancelPublish：无运行任务时直接返回", async () => {
    const { result } = renderHook(() => usePublishExecute(params));

    await act(async () => {
      await result.current.cancelPublish();
    });

    expect(mocks.cancelPublishRuntime).not.toHaveBeenCalled();
    expect(mocks.toast.message).not.toHaveBeenCalled();
  });

  it("cancelPublish：后端无运行任务时给出提示", async () => {
    mocks.synchronizePublishRuntime.mockResolvedValue({
      attemptId: "attempt-1",
      acceptedEvents: 0,
      duplicateEvents: 0,
      missingRanges: [],
      result: { attempt: { status: "running", attemptId: "attempt-1" } },
    });
    mocks.cancelPublishRuntime.mockResolvedValue(false);

    const { result } = renderHook(() => usePublishExecute(params));
    await waitFor(() =>
      expect(result.current.runtimeResult?.attempt.status).toBe("running")
    );

    await act(async () => {
      await result.current.cancelPublish();
    });

    expect(mocks.cancelPublishRuntime).toHaveBeenCalledWith({
      attemptId: "attempt-1",
    });
    expect(mocks.toast.message).toHaveBeenCalledWith(
      "当前没有运行中的发布任务"
    );
  });

  it("cancelPublish：取消失败经延迟加载给出本地化反馈", async () => {
    mocks.synchronizePublishRuntime.mockResolvedValue({
      attemptId: "attempt-1",
      acceptedEvents: 0,
      duplicateEvents: 0,
      missingRanges: [],
      result: { attempt: { status: "running", attemptId: "attempt-1" } },
    });
    mocks.cancelPublishRuntime.mockRejectedValue({
      code: "publish_cancel_failed",
      message: "backend refused",
    });

    const { result } = renderHook(() => usePublishExecute(params));
    await waitFor(() =>
      expect(result.current.runtimeResult?.attempt.status).toBe("running")
    );

    await act(async () => {
      await result.current.cancelPublish();
    });

    expect(mocks.toast.error).toHaveBeenCalledWith("取消发布失败", {
      description: "取消发送失败，请检查进程状态后重试。",
    });
  });

  it("attempt 不确定时经同步恢复并挂起运行", async () => {
    mocks.preparePublishRuntime.mockResolvedValue({
      status: "ready",
      runtimeToken: "rt",
      configurationRevisionId: "cfg-1",
      resolvedSpec: { provider_id: "dotnet" },
      command: "dotnet publish",
    });
    vi.mocked(validate.runPublishPreflight).mockResolvedValue(true);
    mocks.startPublishRuntime.mockRejectedValue({
      code: "publish_runtime_attempt_uncertain",
      message: "attempt uncertain",
      details: "attempt-r",
    });
    mocks.synchronizePublishRuntime
      .mockResolvedValueOnce({ result: null, missingRanges: [] })
      .mockResolvedValue({
        attemptId: "attempt-r",
        acceptedEvents: 0,
        duplicateEvents: 0,
        missingRanges: [],
        result: { attempt: { status: "running", attemptId: "attempt-r" } },
      });

    const { result } = renderHook(() => usePublishExecute(params));
    await act(async () => {
      await result.current.runPublishSpec({
        kind: "empty",
        providerId: "dotnet",
      } as Parameters<typeof result.current.runPublishSpec>[0]);
    });

    expect(mocks.synchronizePublishRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        repositoryPath: "/repo",
        configurationRevisionId: "cfg-1",
        attemptId: "attempt-r",
      })
    );
    expect(result.current.runtimeResult?.attempt.attemptId).toBe("attempt-r");
  });

  it("attempt 不确定且恢复同步失败时提示恢复失败", async () => {
    mocks.preparePublishRuntime.mockResolvedValue({
      status: "ready",
      runtimeToken: "rt",
      configurationRevisionId: "cfg-1",
      resolvedSpec: { provider_id: "dotnet" },
      command: "dotnet publish",
    });
    vi.mocked(validate.runPublishPreflight).mockResolvedValue(true);
    mocks.startPublishRuntime.mockRejectedValue({
      code: "publish_runtime_attempt_uncertain",
      message: "attempt uncertain",
      details: "attempt-r",
    });
    mocks.synchronizePublishRuntime
      .mockResolvedValueOnce({ result: null })
      .mockRejectedValue(new Error("sync exploded"));

    const { result } = renderHook(() => usePublishExecute(params));
    await act(async () => {
      await result.current.runPublishSpec({
        kind: "empty",
        providerId: "dotnet",
      } as Parameters<typeof result.current.runPublishSpec>[0]);
    });

    expect(mocks.toast.error).toHaveBeenCalledWith("恢复发布状态失败", {
      description: expect.any(String),
    });
  });

  it("运行完成但缺少 provider 结果时进入失败反馈", async () => {
    mocks.preparePublishRuntime.mockResolvedValue({
      status: "ready",
      runtimeToken: "rt",
      resolvedSpec: { provider_id: "dotnet" },
      command: "dotnet publish",
    });
    vi.mocked(validate.runPublishPreflight).mockResolvedValue(true);
    mocks.startPublishRuntime.mockResolvedValue({
      attempt: { status: "succeeded", attemptId: "a-1" },
      publishResult: null,
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
    expect(failed[0].error).toContain(
      "PublishRuntime completed without a provider result"
    );
  });
});
