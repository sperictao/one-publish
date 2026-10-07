import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProviderPublishSpec } from "@/features/publish/publishRuntime";
import en from "@/i18n/en.json";
import zh from "@/i18n/zh.json";

const mocks = vi.hoisted(() => ({
  runEnvironmentCheck: vi.fn(),
  preflightPublishOutput: vi.fn(),
}));

vi.mock("@/features/environment/environment", () => ({
  runEnvironmentCheck: mocks.runEnvironmentCheck,
  createEnvironmentCheckSnapshot: () => null,
}));

vi.mock("@/features/publish/publishOutputPreflight", () => ({
  preflightPublishOutput: mocks.preflightPublishOutput,
  requestProtectedOutputAccess: vi.fn(),
  requestPreparedOutputDirectoryAccess: vi.fn(),
  buildProtectedOutputAccessDescription: () => "",
  buildPublishOutputValidationTitle: () => "",
  buildPublishOutputValidationDescription: () => "",
}));

import { createPublishPreflightPipeline } from "@/features/publish/publishPreflight";

const spec = { provider_id: "dotnet" } as ProviderPublishSpec;
const options = {
  runRevision: 1,
  feedbackMode: "toast" as const,
  restoreWindowOnFailure: false,
  trayStatusEffect: false,
  isCancelled: () => false,
};
// Tauri invoke 以 AppError 对象 reject。
const permissionDenied = {
  kind: "repository",
  message: "缺少权限",
  details: "/Users/u/Downloads",
  code: "permission_denied",
};

function createPipeline(getTranslations: () => Record<string, unknown>) {
  const notifyFeedback = vi.fn().mockResolvedValue(false);
  const pipeline = createPublishPreflightPipeline({
    appT: en.app,
    getTranslations,
    notifyFeedback,
    syncTrayPublishStatus: vi.fn(),
    restoreMainWindowIfNeeded: vi.fn(),
    resetLogCapture: vi.fn(),
    isCurrentPresentationRevision: () => true,
    openEnvironmentDialog: vi.fn(),
    setEnvironmentLastCheck: vi.fn(),
  });
  return { pipeline, notifyFeedback };
}

describe("createPublishPreflightPipeline invoke 失败本地化", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runEnvironmentCheck.mockResolvedValue({ issues: [] });
  });

  it("环境检查失败按 errors.<code> 本地化描述", async () => {
    mocks.runEnvironmentCheck.mockRejectedValue(permissionDenied);
    const { pipeline, notifyFeedback } = createPipeline(() => en);

    await expect(pipeline.runPublishPreflight(spec, options)).resolves.toBe(
      false
    );

    expect(notifyFeedback).toHaveBeenCalledWith(
      "error",
      "Environment check failed",
      "Permission denied. | /Users/u/Downloads",
      "toast"
    );
  });

  it("发布目录预检失败在提示时读取最新翻译", async () => {
    mocks.preflightPublishOutput.mockRejectedValue(permissionDenied);
    let translations: Record<string, unknown> = en;
    const { pipeline, notifyFeedback } = createPipeline(() => translations);

    translations = zh;
    await pipeline.runPublishPreflight(spec, options);

    expect(notifyFeedback).toHaveBeenCalledWith(
      "error",
      "Publish output preflight failed",
      "缺少访问权限 | /Users/u/Downloads",
      "toast"
    );
  });
});
