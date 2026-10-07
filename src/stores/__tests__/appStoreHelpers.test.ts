import { beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/en.json";

const mocks = vi.hoisted(() => ({
  getAppState: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/store/api", () => ({ getAppState: mocks.getAppState }));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));

import { __setTranslationsCacheForTest } from "@/hooks/useI18n";
import { makeHandlePersistenceFailure } from "@/stores/appStoreHelpers";
import type { AppState } from "@/lib/store/types";

// Tauri invoke 以 AppError 对象 reject；store 后端 message 恒为中文。
const writeFailure = {
  kind: "store",
  message: "写入临时文件失败",
  details: "No space left on device (os error 28)",
  code: "store_write_failed",
};

describe("makeHandlePersistenceFailure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    __setTranslationsCacheForTest({ en });
    localStorage.setItem("app-language", "en");
  });

  it("持久化失败的 toast 描述按当前界面语言本地化", async () => {
    mocks.getAppState.mockResolvedValue({} as AppState);
    const set = vi.fn();
    const handle = makeHandlePersistenceFailure(set, () => ({}) as AppState);

    await handle("保存偏好设置失败", writeFailure);

    expect(set).toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith("保存偏好设置失败", {
      description:
        "Couldn't write the settings file. | No space left on device (os error 28)",
    });
  });

  it("重新加载权威状态也失败时两段原因都本地化", async () => {
    mocks.getAppState.mockRejectedValue({
      kind: "store",
      message: "写入状态锁失败",
      details: "poisoned lock",
      code: "store_lock_write_failed",
    });
    const handle = makeHandlePersistenceFailure(
      vi.fn(),
      () => ({}) as AppState
    );

    await handle("保存界面状态失败", writeFailure);

    expect(mocks.toastError).toHaveBeenCalledWith("保存界面状态失败", {
      description:
        "Couldn't write the settings file. | No space left on device (os error 28)；Couldn't acquire the app state write lock. | poisoned lock",
    });
  });
});
