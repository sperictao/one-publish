import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/en.json";
import zh from "@/i18n/zh.json";
import type { PublishCompletedEvent } from "@/features/publish/publishEvents";
import { emit } from "@/lib/eventBus";
import type { ExecutionRecord } from "@/lib/store/types";

const mocks = vi.hoisted(() => ({
  openOutputDirectory: vi.fn(),
  translations: {} as Record<string, unknown>,
  on: vi.fn(),
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("sonner", () => ({ toast: mocks.toast }));

vi.mock("@/lib/store/api", () => ({
  openOutputDirectory: mocks.openOutputDirectory,
  setTrayPublishStatus: vi.fn(),
  showMainWindow: vi.fn(),
}));

vi.mock("@/lib/systemNotification", () => ({
  showSystemNotification: vi.fn(),
}));

vi.mock("@/hooks/useI18n", () => ({
  useI18n: () => ({ translations: mocks.translations }),
}));

// 透传真实订阅，同时记录订阅次数。
vi.mock("@/lib/eventBus", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/eventBus")>();
  mocks.on.mockImplementation(actual.on);
  return { ...actual, on: mocks.on };
});

import { usePublishNotify } from "@/features/publish/usePublishNotify";

const OUTPUT_DIR = "/exports/App/Release";
// 依赖必须稳定，否则每次渲染都会重新订阅事件。
const appT = {};
const publishT = {};
const savePublishRecord = vi.fn().mockResolvedValue(undefined);

function completedEvent(): PublishCompletedEvent {
  return {
    repoId: "repo-1",
    outputDir: OUTPUT_DIR,
    outputLog: "",
    shouldOpenOutputDir: true,
    feedbackMode: "toast",
    trayStatusEffect: false,
    restoreWindowOnFailure: false,
    record: { id: "record-1" } as ExecutionRecord,
  };
}

// Tauri invoke 以 AppError 对象 reject，而不是 Error 实例。
function outputDirError(code: string, message: string) {
  return { kind: "export", message, details: OUTPUT_DIR, code };
}

function renderPublishNotify(
  overrides: {
    appT?: Record<string, string | undefined>;
    publishT?: Record<string, string | undefined>;
  } = {}
) {
  const resolvedAppT = overrides.appT ?? appT;
  const resolvedPublishT = overrides.publishT ?? publishT;
  return renderHook(() =>
    usePublishNotify({
      appT: resolvedAppT,
      publishT: resolvedPublishT,
      savePublishRecord,
    })
  );
}

describe("usePublishNotify 打开输出目录失败", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.translations = zh;
  });

  it("用错误码文案描述失败，而不是把 AppError 字符串化", async () => {
    mocks.openOutputDirectory.mockRejectedValue(
      outputDirError("output_dir_not_directory", "输出目录不是文件夹")
    );
    renderPublishNotify();

    emit("publish:completed", completedEvent());

    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("打开输出目录失败", {
        description: `输出路径不是文件夹 | ${OUTPUT_DIR}`,
      })
    );
  });

  it("切换语言不重新订阅发布事件，且失败文案跟随最新语言", async () => {
    mocks.openOutputDirectory.mockRejectedValue(
      outputDirError("output_dir_not_found", "输出目录不存在")
    );
    const { rerender } = renderPublishNotify();
    const subscriptions = mocks.on.mock.calls.length;

    mocks.translations = en;
    rerender();

    expect(mocks.on).toHaveBeenCalledTimes(subscriptions);

    emit("publish:completed", completedEvent());

    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("打开输出目录失败", {
        description: `The output directory doesn't exist. | ${OUTPUT_DIR}`,
      })
    );
  });
});

describe("usePublishNotify 发布成功通知的目录文案", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.translations = zh;
    mocks.openOutputDirectory.mockResolvedValue(undefined);
  });

  it("把含 $ 替换模式的输出目录按字面量写入成功提示", async () => {
    const outputDir = "/out/$&-$$-$'-$`";

    renderPublishNotify();
    emit("publish:completed", { ...completedEvent(), outputDir });

    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith("发布成功!", {
        description: `输出目录: ${outputDir}`,
      })
    );
  });

  it("展开重复的 {{dir}}、保留未知占位符且不二次展开目录中的字面量", async () => {
    const outputDir = "/out/{{dir}}";

    renderPublishNotify({
      publishT: { output: "{{dir}} | {{dir}} | {{unknown}}" },
    });
    emit("publish:completed", { ...completedEvent(), outputDir });

    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith("发布成功!", {
        description: "/out/{{dir}} | /out/{{dir}} | {{unknown}}",
      })
    );
  });

  it("普通输出目录与内置译文保持原有文案", async () => {
    renderPublishNotify({ publishT: { output: "输出目录: {{dir}}" } });

    emit("publish:completed", completedEvent());

    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith("发布成功!", {
        description: `输出目录: ${OUTPUT_DIR}`,
      })
    );
  });
});

describe("trayStatusEffect 关闭时跳过托盘同步", () => {
  it("publish:failed 不调用 setTrayPublishStatus 但仍通知", async () => {
    const { setTrayPublishStatus } = await import("@/lib/store/api");
    renderPublishNotify();
    const failedEvent = {
      ...completedEvent(),
      error: "boom",
      feedbackTitle: "发布失败",
      feedbackDescription: "build failed",
      restoreWindowOnFailure: false,
      trayStatusEffect: false,
    };

    emit("publish:failed", failedEvent);
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalled());
    expect(vi.mocked(setTrayPublishStatus)).not.toHaveBeenCalled();
  });

  it("publish:cancelled 不调用 setTrayPublishStatus 但仍通知", async () => {
    const { setTrayPublishStatus } = await import("@/lib/store/api");
    renderPublishNotify();
    const cancelledEvent = {
      repoId: "repo-1",
      error: "cancelled",
      outputLog: "",
      feedbackMode: "toast" as const,
      trayStatusEffect: false,
      restoreWindowOnFailure: false,
      record: { id: "record-1" } as ExecutionRecord,
    };

    emit("publish:cancelled", cancelledEvent);
    await waitFor(() => expect(mocks.toast.warning).toHaveBeenCalled());
    expect(vi.mocked(setTrayPublishStatus)).not.toHaveBeenCalled();
  });
});
