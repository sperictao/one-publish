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

describe("cancellation interleaves", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runEnvironmentCheck.mockResolvedValue(envResult());
    mocks.preflightPublishOutput.mockResolvedValue(preflight());
  });

  function cancelling() {
    const state = { flag: false };
    return {
      state,
      isCancelled: () => state.flag,
    };
  }

  it("stops after the environment check resolves when cancelled", async () => {
    const c = cancelling();
    mocks.runEnvironmentCheck.mockImplementation(async () => {
      c.state.flag = true;
      return envResult();
    });
    const d = deps();
    const ok = await createPublishPreflightPipeline(d).runPublishPreflight(
      SPEC,
      options({ isCancelled: c.isCancelled })
    );
    expect(ok).toBe(false);
    expect(mocks.preflightPublishOutput).not.toHaveBeenCalled();
  });

  it("stops inside the critical branch when cancelled", async () => {
    const c = cancelling();
    mocks.runEnvironmentCheck.mockResolvedValue(
      envResult([issue("critical", "dotnet missing")])
    );
    const d = deps();
    d.setEnvironmentLastCheck.mockImplementation(() => {
      c.state.flag = true;
    });
    const ok = await createPublishPreflightPipeline(d).runPublishPreflight(
      SPEC,
      options({ isCancelled: c.isCancelled })
    );
    expect(ok).toBe(false);
    expect(d.notifyFeedback).not.toHaveBeenCalled();
  });

  it("stops inside the warning branch when cancelled", async () => {
    const c = cancelling();
    mocks.runEnvironmentCheck.mockResolvedValue(
      envResult([issue("warning", "old sdk")])
    );
    const d = deps();
    d.setEnvironmentLastCheck.mockImplementation(() => {
      c.state.flag = true;
    });
    const ok = await createPublishPreflightPipeline(d).runPublishPreflight(
      SPEC,
      options({ isCancelled: c.isCancelled })
    );
    expect(ok).toBe(false);
    expect(d.notifyFeedback).not.toHaveBeenCalled();
  });

  it("swallows the environment check failure when cancelled", async () => {
    const c = cancelling();
    mocks.runEnvironmentCheck.mockImplementation(async () => {
      c.state.flag = true;
      throw new Error("probe down");
    });
    const d = deps();
    const ok = await createPublishPreflightPipeline(d).runPublishPreflight(
      SPEC,
      options({ isCancelled: c.isCancelled })
    );
    expect(ok).toBe(false);
    expect(d.notifyFeedback).not.toHaveBeenCalled();
  });

  it("stops before output preflight when cancelled", async () => {
    const c = cancelling();
    const d = deps();
    d.setEnvironmentLastCheck.mockImplementation(() => {
      c.state.flag = true;
    });
    const ok = await createPublishPreflightPipeline(d).runPublishPreflight(
      SPEC,
      options({ isCancelled: c.isCancelled })
    );
    expect(ok).toBe(false);
    expect(mocks.preflightPublishOutput).not.toHaveBeenCalled();
  });

  it("stops after output preflight resolves when cancelled", async () => {
    const c = cancelling();
    mocks.preflightPublishOutput.mockImplementation(async () => {
      c.state.flag = true;
      return preflight();
    });
    const d = deps();
    const ok = await createPublishPreflightPipeline(d).runPublishPreflight(
      SPEC,
      options({ isCancelled: c.isCancelled })
    );
    expect(ok).toBe(false);
    expect(d.notifyFeedback).not.toHaveBeenCalled();
  });

  it("swallows the output preflight failure when cancelled", async () => {
    const c = cancelling();
    mocks.preflightPublishOutput.mockImplementation(async () => {
      c.state.flag = true;
      throw new Error("io");
    });
    const d = deps();
    const ok = await createPublishPreflightPipeline(d).runPublishPreflight(
      SPEC,
      options({ isCancelled: c.isCancelled })
    );
    expect(ok).toBe(false);
    expect(d.notifyFeedback).not.toHaveBeenCalled();
  });

  it("stops inside the incompatible branch when cancelled", async () => {
    const c = cancelling();
    mocks.preflightPublishOutput.mockImplementation(async () => {
      c.state.flag = true;
      return preflight({
        validation: { status: "incompatible", issue: null },
      });
    });
    const d = deps();
    const ok = await createPublishPreflightPipeline(d).runPublishPreflight(
      SPEC,
      options({ isCancelled: c.isCancelled })
    );
    expect(ok).toBe(false);
    expect(d.notifyFeedback).not.toHaveBeenCalled();
  });

  it("stops inside the access request when the window restore cancels", async () => {
    const c = cancelling();
    mocks.preflightPublishOutput.mockResolvedValue(deniedPreflight());
    const d = deps();
    d.restoreMainWindowIfNeeded.mockImplementation(async () => {
      c.state.flag = true;
    });
    const ok = await createPublishPreflightPipeline(d).runPublishPreflight(
      SPEC,
      options({ isCancelled: c.isCancelled })
    );
    expect(ok).toBe(false);
    expect(mocks.requestProtectedOutputAccess).not.toHaveBeenCalled();
  });

  it("stops at the second denied check when the request cancels", async () => {
    const c = cancelling();
    mocks.preflightPublishOutput.mockResolvedValue(deniedPreflight());
    mocks.requestProtectedOutputAccess.mockImplementation(async () => {
      c.state.flag = true;
      return { preflight: deniedPreflight() };
    });
    const d = deps();
    const ok = await createPublishPreflightPipeline(d).runPublishPreflight(
      SPEC,
      options({ isCancelled: c.isCancelled })
    );
    expect(ok).toBe(false);
    expect(d.notifyFeedback).not.toHaveBeenCalled();
  });

  it("swallows the access request failure when cancelled", async () => {
    const c = cancelling();
    mocks.preflightPublishOutput.mockResolvedValue(deniedPreflight());
    mocks.requestProtectedOutputAccess.mockImplementation(async () => {
      c.state.flag = true;
      throw new Error("access io");
    });
    const d = deps();
    const ok = await createPublishPreflightPipeline(d).runPublishPreflight(
      SPEC,
      options({ isCancelled: c.isCancelled })
    );
    expect(ok).toBe(false);
    expect(d.notifyFeedback).not.toHaveBeenCalled();
  });

  it("stops the abort flow after the tray sync when cancelled", async () => {
    const c = cancelling();
    mocks.runEnvironmentCheck.mockResolvedValue(
      envResult([issue("critical", "dotnet missing")])
    );
    const d = deps();
    d.syncTrayPublishStatus.mockImplementation(async () => {
      c.state.flag = true;
    });
    const ok = await createPublishPreflightPipeline(d).runPublishPreflight(
      SPEC,
      options({ isCancelled: c.isCancelled, trayStatusEffect: true })
    );
    expect(ok).toBe(false);
    expect(d.notifyFeedback).not.toHaveBeenCalled();
  });

  it("stops the abort flow after notification when cancelled", async () => {
    const c = cancelling();
    mocks.runEnvironmentCheck.mockResolvedValue(
      envResult([issue("critical", "dotnet missing")])
    );
    const d = deps();
    d.notifyFeedback.mockImplementation(async () => {
      c.state.flag = true;
      return true;
    });
    const ok = await createPublishPreflightPipeline(d).runPublishPreflight(
      SPEC,
      options({ isCancelled: c.isCancelled })
    );
    expect(ok).toBe(false);
    expect(d.resetLogCapture).not.toHaveBeenCalled();
    expect(d.restoreMainWindowIfNeeded).not.toHaveBeenCalled();
  });

  it("skips the window restore when cancelled after log reset", async () => {
    const c = cancelling();
    mocks.runEnvironmentCheck.mockResolvedValue(
      envResult([issue("critical", "dotnet missing")])
    );
    const d = deps();
    d.resetLogCapture.mockImplementation(() => {
      c.state.flag = true;
    });
    const ok = await createPublishPreflightPipeline(d).runPublishPreflight(
      SPEC,
      options({ isCancelled: c.isCancelled })
    );
    expect(ok).toBe(false);
    expect(d.resetLogCapture).toHaveBeenCalled();
    expect(d.restoreMainWindowIfNeeded).not.toHaveBeenCalled();
  });

  it("returns early from abort when already cancelled at entry", async () => {
    mocks.runEnvironmentCheck.mockResolvedValue(
      envResult([issue("critical", "dotnet missing")])
    );
    let calls = 0;
    const isCancelled = () => ++calls >= 4;
    const d = deps();
    const ok = await createPublishPreflightPipeline(d).runPublishPreflight(
      SPEC,
      options({ isCancelled })
    );
    expect(ok).toBe(false);
    expect(d.notifyFeedback).not.toHaveBeenCalled();
    expect(d.restoreMainWindowIfNeeded).not.toHaveBeenCalled();
  });

  it("stops inside the incompatible branch at its cancel point", async () => {
    mocks.preflightPublishOutput.mockResolvedValue(
      preflight({ validation: { status: "incompatible", issue: null } })
    );
    let calls = 0;
    const isCancelled = () => ++calls >= 5;
    const d = deps();
    const ok = await createPublishPreflightPipeline(d).runPublishPreflight(
      SPEC,
      options({ isCancelled })
    );
    expect(ok).toBe(false);
    expect(d.notifyFeedback).not.toHaveBeenCalled();
  });

  it("returns null from the access request when cancelled at its entry", async () => {
    mocks.preflightPublishOutput.mockResolvedValue(deniedPreflight());
    let calls = 0;
    const isCancelled = () => ++calls >= 5;
    const d = deps();
    const ok = await createPublishPreflightPipeline(d).runPublishPreflight(
      SPEC,
      options({ isCancelled })
    );
    expect(ok).toBe(false);
    expect(d.restoreMainWindowIfNeeded).not.toHaveBeenCalled();
    expect(mocks.requestProtectedOutputAccess).not.toHaveBeenCalled();
  });

  it("stops at the post-request denied check when cancelled", async () => {
    mocks.preflightPublishOutput.mockResolvedValue(deniedPreflight());
    mocks.requestProtectedOutputAccess.mockResolvedValue({
      preflight: deniedPreflight(),
    });
    let calls = 0;
    const isCancelled = () => ++calls >= 8;
    const d = deps();
    const ok = await createPublishPreflightPipeline(d).runPublishPreflight(
      SPEC,
      options({ isCancelled })
    );
    expect(ok).toBe(false);
    expect(d.notifyFeedback).not.toHaveBeenCalled();
  });

  it("refuses runtime output access when cancelled after the restore", async () => {
    const c = cancelling();
    const d = deps();
    d.restoreMainWindowIfNeeded.mockImplementation(async () => {
      c.state.flag = true;
    });
    mocks.requestPreparedOutputDirectoryAccess.mockResolvedValue(true);
    const ok = await createPublishPreflightPipeline(
      d
    ).requestRuntimeOutputAccess(
      {
        status: "blocked",
        diagnostics: [
          { code: "publish_output_access_denied", message: "denied" },
        ],
        outputPreflight: { outputDir: "/out", accessStatus: "denied" },
      } as PreparedPublishRuntime,
      c.isCancelled
    );
    expect(ok).toBe(false);
    expect(mocks.requestPreparedOutputDirectoryAccess).not.toHaveBeenCalled();
  });
});
