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

function renderPublishNotify() {
  return renderHook(() =>
    usePublishNotify({ appT, publishT, savePublishRecord })
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
