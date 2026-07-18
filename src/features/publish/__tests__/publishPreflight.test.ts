import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EnvironmentCheckResult } from "@/features/environment/environment";

const mocks = vi.hoisted(() => ({
  runEnvironmentCheck: vi.fn(),
  createEnvironmentCheckSnapshot: vi.fn(
    (result: EnvironmentCheckResult, providerIds?: string[]) => ({
      providerIds: providerIds ?? [],
      result,
    })
  ),
  preflightPublishOutput: vi.fn(),
  requestProtectedOutputAccess: vi.fn(),
  extractInvokeErrorMessage: vi.fn(
    (error: unknown) =>
      error instanceof Error ? error.message : String(error)
  ),
}));

vi.mock("@/features/environment/environment", () => ({
  runEnvironmentCheck: mocks.runEnvironmentCheck,
  createEnvironmentCheckSnapshot: mocks.createEnvironmentCheckSnapshot,
}));

vi.mock("@/features/publish/publishOutputPreflight", () => ({
  preflightPublishOutput: mocks.preflightPublishOutput,
  requestProtectedOutputAccess: mocks.requestProtectedOutputAccess,
  buildProtectedOutputAccessDescription: () => "需要授权 Downloads",
  buildPublishOutputValidationTitle: () => "发布目录无效",
  buildPublishOutputValidationDescription: () => "路径与当前系统不兼容",
}));

vi.mock("@/lib/tauri/invokeErrors", () => ({
  extractInvokeErrorMessage: mocks.extractInvokeErrorMessage,
  analyzePublishExecutionFailure: () => "process_failed",
  extractInvokeErrorCode: () => "publish_cancel_failed",
}));

import { createPublishPreflightPipeline } from "@/features/publish/publishPreflight";
import type { ProviderPublishSpec } from "@/features/publish/publishRuntime";

const blockedEnvironment: EnvironmentCheckResult = {
  is_ready: false,
  providers: [],
  issues: [
    {
      severity: "critical",
      provider_id: "dotnet",
      issue_type: "missing_tool",
      description: ".NET SDK missing",
      fixes: [],
    },
  ],
  checked_at: "2026-07-18T10:00:00.000Z",
};

const dotnetSpec: ProviderPublishSpec = {
  version: 1,
  provider_id: "dotnet",
  project_path: "/repo/App.csproj",
  parameters: { configuration: "Release" },
};

function createDeps(options: { resetLogCapture: () => void }) {
  return {
    appT: {
      environmentBlocked: "环境未就绪，已阻止发布",
    },
    notifyFeedback: vi.fn().mockResolvedValue(true),
    syncTrayPublishStatus: vi.fn().mockResolvedValue(undefined),
    restoreMainWindowIfNeeded: vi.fn().mockResolvedValue(undefined),
    resetLogCapture: options.resetLogCapture,
    openEnvironmentDialog: vi.fn(),
    setEnvironmentLastCheck: vi.fn(),
  };
}

describe("createPublishPreflightPipeline - resetLogCapture 修订守卫", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runEnvironmentCheck.mockResolvedValue(blockedEnvironment);
  });

  it("preflight 失败且 runRevision 为当前时调用 resetLogCapture", async () => {
    const resetLogCapture = vi.fn();
    const { runPublishPreflight } = createPublishPreflightPipeline(
      createDeps({ resetLogCapture })
    );

    // checker 报告 runRevision=1 仍是当前展示态
    const isCurrentPresentationRevision = vi.fn((rev: number) => rev === 1);

    const passed = await runPublishPreflight(dotnetSpec, {
      runRevision: 1,
      isCurrentPresentationRevision,
      feedbackMode: "toast",
      restoreWindowOnFailure: true,
      trayStatusEffect: false,
    });

    expect(passed).toBe(false);
    expect(isCurrentPresentationRevision).toHaveBeenCalledWith(1);
    expect(resetLogCapture).toHaveBeenCalledTimes(1);
  });

  it("preflight 失败但修订已前进时不调用 resetLogCapture", async () => {
    const resetLogCapture = vi.fn();
    const { runPublishPreflight } = createPublishPreflightPipeline(
      createDeps({ resetLogCapture })
    );

    // checker 报告 runRevision=1 已被后续 runRevision=2 覆盖
    const isCurrentPresentationRevision = vi.fn((rev: number) => rev === 2);

    const passed = await runPublishPreflight(dotnetSpec, {
      runRevision: 1,
      isCurrentPresentationRevision,
      feedbackMode: "toast",
      restoreWindowOnFailure: true,
      trayStatusEffect: false,
    });

    expect(passed).toBe(false);
    expect(isCurrentPresentationRevision).toHaveBeenCalledWith(1);
    expect(resetLogCapture).not.toHaveBeenCalled();
  });
});
