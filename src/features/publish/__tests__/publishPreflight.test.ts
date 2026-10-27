import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runEnvironmentCheck: vi.fn(),
  preflightPublishOutput: vi.fn(),
  requestProtectedOutputAccess: vi.fn(),
  requestPreparedOutputDirectoryAccess: vi.fn(),
}));

vi.mock("@/features/environment/environment", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/environment/environment")
  >("@/features/environment/environment");
  return { ...actual, runEnvironmentCheck: mocks.runEnvironmentCheck };
});

vi.mock("@/features/publish/publishOutputPreflight", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/publish/publishOutputPreflight")
  >("@/features/publish/publishOutputPreflight");
  return {
    ...actual,
    preflightPublishOutput: mocks.preflightPublishOutput,
    requestProtectedOutputAccess: mocks.requestProtectedOutputAccess,
    requestPreparedOutputDirectoryAccess:
      mocks.requestPreparedOutputDirectoryAccess,
  };
});

import { createPublishPreflightPipeline } from "@/features/publish/publishPreflight";
import type { PublishOutputPreflightResult } from "@/features/publish/publishRuntime";
import type { PreparedPublishRuntime } from "@/generated/tauri-contracts";

const SPEC = {
  version: 1,
  provider_id: "dotnet",
  project_path: "/repo/app",
  parameters: {},
} as never;

function envResult(issues: Array<Record<string, unknown>> = []) {
  return {
    is_ready: issues.every((item) => item.severity !== "critical"),
    providers: [],
    issues,
    checked_at: "2026-01-01T00:00:00Z",
  };
}

function issue(severity: string, description = "desc") {
  return {
    severity,
    provider_id: "dotnet",
    issue_type: "missing_tool",
    description,
    current_value: null,
    expected_value: null,
    fixes: [],
  };
}

function preflight(
  overrides: Partial<PublishOutputPreflightResult> = {}
): PublishOutputPreflightResult {
  return {
    outputDir: "/out",
    configuredOutputDir: null,
    validation: { status: "compatible", issue: null },
    access: {
      status: "granted",
      protectedLocation: null,
      protectedRoot: null,
      probeDirectory: null,
      detail: null,
    },
    ...overrides,
  } as PublishOutputPreflightResult;
}

function deniedPreflight(): PublishOutputPreflightResult {
  return preflight({
    access: {
      status: "denied",
      protectedLocation: "documents",
      protectedRoot: "/Users/me/Documents",
      probeDirectory: "/Users/me/Documents/out",
      detail: null,
    },
  });
}

function deps() {
  return {
    appT: {},
    getTranslations: () => ({}),
    notifyFeedback: vi.fn().mockResolvedValue(true),
    syncTrayPublishStatus: vi.fn().mockResolvedValue(undefined),
    restoreMainWindowIfNeeded: vi.fn().mockResolvedValue(undefined),
    resetLogCapture: vi.fn(),
    openEnvironmentDialog: vi.fn(),
    setEnvironmentLastCheck: vi.fn(),
  };
}

function options(overrides: Record<string, unknown> = {}) {
  return {
    feedbackMode: "toast" as const,
    restoreWindowOnFailure: false,
    trayStatusEffect: false,
    isCancelled: () => false,
    runRevision: 1,
    isCurrentPresentationRevision: () => true,
    ...overrides,
  };
}

describe("createPublishPreflightPipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runEnvironmentCheck.mockResolvedValue(envResult());
    mocks.preflightPublishOutput.mockResolvedValue(preflight());
  });

  it("returns false immediately when cancelled", async () => {
    const d = deps();
    const pipeline = createPublishPreflightPipeline(d);

    const ok = await pipeline.runPublishPreflight(
      SPEC,
      options({ isCancelled: () => true })
    );

    expect(ok).toBe(false);
    expect(mocks.runEnvironmentCheck).not.toHaveBeenCalled();
  });

  it("returns true on the happy path", async () => {
    const d = deps();
    const pipeline = createPublishPreflightPipeline(d);

    const ok = await pipeline.runPublishPreflight(SPEC, options());

    expect(ok).toBe(true);
    expect(d.setEnvironmentLastCheck).toHaveBeenCalled();
  });

  it("aborts on a critical environment issue and opens the env dialog", async () => {
    mocks.runEnvironmentCheck.mockResolvedValue(
      envResult([issue("critical", "dotnet missing")])
    );
    const d = deps();
    const pipeline = createPublishPreflightPipeline(d);

    const ok = await pipeline.runPublishPreflight(SPEC, options());

    expect(ok).toBe(false);
    expect(d.notifyFeedback).toHaveBeenCalledWith(
      "error",
      "环境未就绪，已阻止发布",
      "dotnet missing",
      "toast"
    );
    expect(d.openEnvironmentDialog).toHaveBeenCalled();
  });

  it("does not open the env dialog in system mode when notified", async () => {
    mocks.runEnvironmentCheck.mockResolvedValue(
      envResult([issue("critical", "dotnet missing")])
    );
    const d = deps();
    const pipeline = createPublishPreflightPipeline(d);

    await pipeline.runPublishPreflight(
      SPEC,
      options({ feedbackMode: "system" })
    );

    expect(d.openEnvironmentDialog).not.toHaveBeenCalled();
  });

  it("warns on a warning environment issue and continues", async () => {
    mocks.runEnvironmentCheck.mockResolvedValue(
      envResult([issue("warning", "old sdk")])
    );
    const d = deps();
    const pipeline = createPublishPreflightPipeline(d);

    const ok = await pipeline.runPublishPreflight(SPEC, options());

    expect(ok).toBe(true);
    expect(d.notifyFeedback).toHaveBeenCalledWith(
      "warning",
      "环境存在警告",
      "old sdk",
      "toast"
    );
  });

  it("aborts when the environment check throws", async () => {
    mocks.runEnvironmentCheck.mockRejectedValue(new Error("env boom"));
    const d = deps();
    const pipeline = createPublishPreflightPipeline(d);

    const ok = await pipeline.runPublishPreflight(SPEC, options());

    expect(ok).toBe(false);
    expect(d.notifyFeedback).toHaveBeenCalledWith(
      "error",
      "环境检查失败",
      expect.any(String),
      "toast"
    );
  });

  it("aborts when output preflight throws", async () => {
    mocks.preflightPublishOutput.mockRejectedValue(new Error("io"));
    const d = deps();
    const pipeline = createPublishPreflightPipeline(d);

    const ok = await pipeline.runPublishPreflight(SPEC, options());

    expect(ok).toBe(false);
    expect(d.notifyFeedback).toHaveBeenCalledWith(
      "error",
      "发布目录预检失败",
      expect.any(String),
      "toast"
    );
  });

  it("aborts on incompatible output validation", async () => {
    mocks.preflightPublishOutput.mockResolvedValue(
      preflight({
        validation: {
          status: "incompatible",
          issue: {
            kind: "windows_path_on_unix",
            detail: "C:\\out",
          },
        },
      } as never)
    );
    const d = deps();
    const pipeline = createPublishPreflightPipeline(d);

    const ok = await pipeline.runPublishPreflight(SPEC, options());

    expect(ok).toBe(false);
    expect(d.notifyFeedback).toHaveBeenCalledWith(
      "error",
      expect.any(String),
      expect.any(String),
      "toast"
    );
  });

  it("continues after a denied directory is authorized", async () => {
    mocks.preflightPublishOutput.mockResolvedValue(deniedPreflight());
    mocks.requestProtectedOutputAccess.mockResolvedValue({
      granted: true,
      preflight: preflight(),
    });
    const d = deps();
    const pipeline = createPublishPreflightPipeline(d);

    const ok = await pipeline.runPublishPreflight(SPEC, options());

    expect(ok).toBe(true);
    expect(d.restoreMainWindowIfNeeded).toHaveBeenCalledWith(true);
    expect(mocks.requestProtectedOutputAccess).toHaveBeenCalled();
  });

  it("aborts when the access request throws", async () => {
    mocks.preflightPublishOutput.mockResolvedValue(deniedPreflight());
    mocks.requestProtectedOutputAccess.mockRejectedValue(
      new Error("tcc denied")
    );
    const d = deps();
    const pipeline = createPublishPreflightPipeline(d);

    const ok = await pipeline.runPublishPreflight(SPEC, options());

    expect(ok).toBe(false);
    expect(d.notifyFeedback).toHaveBeenCalledWith(
      "error",
      "申请目录访问权限失败",
      expect.any(String),
      "toast"
    );
  });

  it("returns false when the access request resolves to null", async () => {
    mocks.preflightPublishOutput.mockResolvedValue(deniedPreflight());
    mocks.requestProtectedOutputAccess.mockResolvedValue(null);
    const d = deps();
    const pipeline = createPublishPreflightPipeline(d);

    const ok = await pipeline.runPublishPreflight(SPEC, options());

    expect(ok).toBe(false);
    expect(d.notifyFeedback).not.toHaveBeenCalled();
  });

  it("aborts when access is still denied after the request", async () => {
    mocks.preflightPublishOutput.mockResolvedValue(deniedPreflight());
    mocks.requestProtectedOutputAccess.mockResolvedValue({
      granted: false,
      preflight: deniedPreflight(),
    });
    const d = deps();
    const pipeline = createPublishPreflightPipeline(d);

    const ok = await pipeline.runPublishPreflight(SPEC, options());

    expect(ok).toBe(false);
    expect(d.notifyFeedback).toHaveBeenCalledWith(
      "error",
      "缺少 macOS 受保护目录访问权限",
      expect.any(String),
      "toast"
    );
  });

  it("syncs tray status and resets log capture on abort", async () => {
    mocks.preflightPublishOutput.mockRejectedValue(new Error("io"));
    const d = deps();
    const pipeline = createPublishPreflightPipeline(d);

    await pipeline.runPublishPreflight(
      SPEC,
      options({ trayStatusEffect: true })
    );

    expect(d.syncTrayPublishStatus).toHaveBeenCalledWith("failure");
    expect(d.resetLogCapture).toHaveBeenCalled();
    expect(d.restoreMainWindowIfNeeded).toHaveBeenCalledWith(false);
  });

  it("restores the window when notify fails", async () => {
    mocks.preflightPublishOutput.mockRejectedValue(new Error("io"));
    const d = deps();
    d.notifyFeedback.mockResolvedValue(false);
    const pipeline = createPublishPreflightPipeline(d);

    await pipeline.runPublishPreflight(SPEC, options());

    expect(d.restoreMainWindowIfNeeded).toHaveBeenCalledWith(true);
  });

  describe("requestRuntimeOutputAccess", () => {
    function blockedPrepared(
      accessStatus = "denied",
      diagnostics = [
        { code: "publish_output_access_denied", message: "denied" },
      ]
    ): PreparedPublishRuntime {
      return {
        status: "blocked",
        diagnostics,
        outputPreflight: {
          outputDir: "/out",
          accessStatus,
        },
      } as PreparedPublishRuntime;
    }

    it("returns false when access cannot be requested", async () => {
      const d = deps();
      const pipeline = createPublishPreflightPipeline(d);

      const ok = await pipeline.requestRuntimeOutputAccess(
        blockedPrepared("granted"),
        () => false
      );

      expect(ok).toBe(false);
      expect(mocks.requestPreparedOutputDirectoryAccess).not.toHaveBeenCalled();
    });

    it("requests access for a denied-output block and reports the result", async () => {
      mocks.requestPreparedOutputDirectoryAccess.mockResolvedValue(true);
      const d = deps();
      const pipeline = createPublishPreflightPipeline(d);

      const ok = await pipeline.requestRuntimeOutputAccess(
        blockedPrepared(),
        () => false
      );

      expect(ok).toBe(true);
      expect(mocks.requestPreparedOutputDirectoryAccess).toHaveBeenCalled();
    });

    it("returns false when authorization is refused or cancelled", async () => {
      mocks.requestPreparedOutputDirectoryAccess.mockResolvedValue(false);
      const d = deps();
      const pipeline = createPublishPreflightPipeline(d);

      expect(
        await pipeline.requestRuntimeOutputAccess(
          blockedPrepared(),
          () => false
        )
      ).toBe(false);

      mocks.requestPreparedOutputDirectoryAccess.mockResolvedValue(true);
      expect(
        await pipeline.requestRuntimeOutputAccess(blockedPrepared(), () => true)
      ).toBe(false);
    });
  });
});
