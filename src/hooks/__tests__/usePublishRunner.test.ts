import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EnvironmentCheckResult } from "@/features/environment/environment";
import type {
  PreparedPublishRuntime,
  PublishRuntimeResult,
} from "@/generated/tauri-contracts";
import type { PublishConfigStore } from "@/lib/store/types";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => false),
  listen: vi.fn(),
  preflightPublishOutput: vi.fn(),
  requestProtectedOutputAccess: vi.fn(),
  analyzePublishExecutionFailure: vi.fn(() => "process_failed"),
  runEnvironmentCheck: vi.fn(),
  showSystemNotification: vi.fn(),
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
  },
  openOutputDirectory: vi.fn(),
  setTrayPublishStatus: vi.fn(),
  showMainWindow: vi.fn(),
  renderPublishCommand: vi.fn(),
  preparePublishRuntime: vi.fn(),
  startPublishRuntime: vi.fn(),
  resumePublishRuntime: vi.fn(),
  synchronizePublishRuntime: vi.fn(),
  cancelPublishRuntime: vi.fn(),
  useDotnetPublishSelection: vi.fn(),
  usePublishSpecBuilder: vi.fn(),
}));
let buildPublishSpecMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  isTauri: mocks.isTauri,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.listen,
}));

vi.mock("sonner", () => ({
  toast: mocks.toast,
}));

vi.mock("@/features/environment/environment", () => ({
  runEnvironmentCheck: mocks.runEnvironmentCheck,
  createEnvironmentCheckSnapshot: (
    result: EnvironmentCheckResult,
    providerIds?: string[]
  ) => ({
    providerIds: providerIds ?? [],
    result,
  }),
}));

vi.mock("@/features/config/useDotnetPublishSelection", () => ({
  useDotnetPublishSelection: mocks.useDotnetPublishSelection,
}));

vi.mock("@/features/publish/usePublishSpecBuilder", () => ({
  usePublishSpecBuilder: mocks.usePublishSpecBuilder,
}));

vi.mock("@/features/publish/publishOutputPreflight", () => ({
  preflightPublishOutput: mocks.preflightPublishOutput,
  requestProtectedOutputAccess: mocks.requestProtectedOutputAccess,
  buildProtectedOutputAccessDescription: () => "需要授权 Downloads",
  buildPublishOutputValidationTitle: (result: {
    validation: { issue: string | null };
  }) =>
    result.validation.issue === "windows_drive_root_missing"
      ? "发布目录无效"
      : "发布目录路径与当前系统不兼容",
  buildPublishOutputValidationDescription: (result: {
    validation: { issue: string | null };
  }) =>
    result.validation.issue === "windows_drive_root_missing"
      ? "发布目录指向不存在的 Windows 盘符"
      : "路径与当前系统不兼容",
}));

vi.mock("@/lib/systemNotification", () => ({
  showSystemNotification: mocks.showSystemNotification,
}));

vi.mock("@/features/publish/renderPublishCommand", () => ({
  renderPublishCommand: mocks.renderPublishCommand,
}));

vi.mock("@/features/publish/publishRuntime", () => ({
  executeProviderPublish: (spec: unknown) =>
    mocks.invoke("execute_provider_publish", { spec }),
  cancelProviderPublish: () => mocks.invoke("cancel_provider_publish"),
  cancelPublishRuntime: mocks.cancelPublishRuntime,
  renderProviderPublish: mocks.renderPublishCommand,
  preflightProviderPublishOutput: mocks.preflightPublishOutput,
  preparePublishRuntime: mocks.preparePublishRuntime,
  startPublishRuntime: mocks.startPublishRuntime,
  resumePublishRuntime: mocks.resumePublishRuntime,
  synchronizePublishRuntime: mocks.synchronizePublishRuntime,
}));

vi.mock("@/lib/store/api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/store/api")>("@/lib/store/api");
  return {
    ...actual,
    openOutputDirectory: mocks.openOutputDirectory,
    setTrayPublishStatus: mocks.setTrayPublishStatus,
    showMainWindow: mocks.showMainWindow,
  };
});

vi.mock("@/lib/tauri/invokeErrors", () => ({
  extractInvokeErrorMessage: (error: unknown) => {
    if (error instanceof Error) {
      return error.message;
    }
    if (error && typeof error === "object" && "message" in error) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string") {
        return message;
      }
    }
    return String(error);
  },
  extractInvokeErrorCode: (error: unknown) =>
    error && typeof error === "object" && "code" in error
      ? String((error as { code: unknown }).code)
      : "publish_cancel_failed",
  extractInvokeErrorDetails: (error: unknown) =>
    error && typeof error === "object" && "details" in error
      ? String((error as { details: unknown }).details)
      : null,
  analyzePublishExecutionFailure: mocks.analyzePublishExecutionFailure,
}));

vi.mock("@/features/publish/usePublishFailureFeedback", () => ({
  getPublishFailureFeedback: () => ({
    title: "发布失败",
    description: "boom",
  }),
}));

import { usePublishRunner } from "@/features/publish/usePublishRunner";
import { usePublishStore } from "@/stores/publishStore";

const readyEnvironment: EnvironmentCheckResult = {
  is_ready: true,
  providers: [],
  issues: [],
  checked_at: "2026-03-28T10:00:00.000Z",
};

const defaultCustomConfig: PublishConfigStore = {
  configuration: "Release",
  runtime: "",
  framework: "",
  selfContained: false,
  outputDir: "",
  noBuild: false,
  noRestore: false,
  verbosity: "",
  noLogo: false,
  deleteExistingFiles: false,
  properties: {},
  useProfile: false,
  profileName: "",
};

const projectProfileSelectionIdentity = {
  kind: "project-profile",
  profileName: "FolderProfile",
  configKey: "pubxml:FolderProfile",
} as const;

const presetSelectionIdentity = {
  kind: "preset",
  presetId: "release-fd",
  configKey: "preset:release-fd",
} as const;

const customSelectionIdentity = {
  kind: "custom",
} as const;

function createRenderedCommand(
  displayCommand = 'dotnet publish "/repo/App.csproj"'
) {
  return {
    program: "dotnet",
    args: ["publish", "/repo/App.csproj"],
    working_dir: "/repo",
    display_command: displayCommand,
    env: [],
  };
}

function createPublishResult(
  overrides: Partial<{
    provider_id: string;
    success: boolean;
    cancelled: boolean;
    error: string | null;
    output_log: string;
    output_dir: string;
    file_count: number;
    warnings: string[] | null;
    command: ReturnType<typeof createRenderedCommand>;
  }> = {}
) {
  return {
    provider_id: "dotnet",
    success: true,
    cancelled: false,
    error: null,
    command: createRenderedCommand(),
    output_log: '$ dotnet publish "/repo/App.csproj"\nBuild succeeded.\n',
    output_dir: "/exports/App/Release",
    file_count: 3,
    warnings: null,
    ...overrides,
  };
}

function createPreparedRuntime(revision: string): PreparedPublishRuntime {
  return {
    configurationId: "profile-42",
    configurationRevisionId: revision,
    command: {
      ...createRenderedCommand(),
      env: [],
    },
    plan: {
      version: 1,
      digest: `plan-${revision}`,
      snapshotDigest: `snapshot-${revision}`,
      executionBackend: "local-execution",
      nodes: [
        {
          id: "build",
          stage: "build" as const,
          adapterId: "selected-project-provider",
          operation: "selected-project-provider:publish",
          cancellable: true,
          cleanupOwnedStaging: false,
          irreversible: false,
        },
      ],
    },
    blockedReason: null,
    runtimeToken: `token-${revision}`,
  };
}

function createRuntimeResult(revision: string): PublishRuntimeResult {
  const publishResult = createPublishResult();
  return {
    attempt: {
      attemptId: `attempt-${revision}`,
      backendRunId: `backend-${revision}`,
      configurationRevisionId: revision,
      planDigest: `plan-${revision}`,
      executionBackend: "local-execution",
      status: "published" as const,
      manifestDigest: `manifest-${revision}`,
      manifest: { digest: `manifest-${revision}`, artifactCount: 3 },
      receipts: [
        {
          version: 1,
          receiptId: `receipt-${revision}`,
          revision: 1,
          routeId: "local-delivery",
          manifestDigest: `manifest-${revision}`,
          status: "published",
          externalReference: "/exports/App/Release",
        },
      ],
      routes: [
        {
          routeId: "local-delivery",
          required: true,
          status: "published" as const,
          externalReference: "/exports/App/Release",
          error: null,
        },
      ],
      warnings: [],
      events: [
        {
          eventId: `event-${revision}`,
          planNodeId: "publish-routes",
          kind: "delivery_receipt_observed",
          manifestDigest: `manifest-${revision}`,
          receiptId: `receipt-${revision}`,
          deliveryStatus: "published",
          receipt: {
            version: 1,
            receiptId: `receipt-${revision}`,
            revision: 1,
            routeId: "local-delivery",
            manifestDigest: `manifest-${revision}`,
            status: "published",
            externalReference: "/exports/App/Release",
          },
          error: null,
        },
      ],
      error: null,
    },
    publishResult,
  };
}

function createRunnerProps() {
  return {
    appT: {
      environmentBlocked: "环境阻断",
      publishOutputPreflightFailed: "发布目录预检失败",
      publishOutputPathInvalid: "发布目录无效",
      publishProtectedDirectoryAccessDenied: "缺少 macOS 受保护目录访问权限",
      publishOutputPathIncompatible: "发布目录路径与当前系统不兼容",
      selectRepositoryFirst: "请先选择仓库",
      selectDotnetProjectFirst: "请先选择项目",
      commandExecuted: "命令执行成功",
    },
    publishT: {
      success: "发布成功",
      failed: "发布失败",
      output: "输出目录: {{dir}}",
      configurationBlocked: "当前发布配置不可执行",
    },
    selectedRepoId: "repo-1",
    selectedRepo: { path: "/repo" },
    activeProviderId: "dotnet",
    activeProviderUsesProjectFile: true,
    activeProviderParameters: {},
    selectedPreset: "profile-FolderProfile",
    isCustomMode: false,
    activeProfileName: null,
    customConfig: defaultCustomConfig,
    defaultOutputDir: "/exports",
    projectInfo: {
      root_path: "/repo",
      project_file: "/repo/App.csproj",
      publish_profiles: ["FolderProfile"],
      target_frameworks: ["net8.0"],
    },
    presets: [],
    specVersion: 1,
    pushRecentConfig: vi.fn(),
    openEnvironmentDialog: vi.fn(),
    setEnvironmentLastCheck: vi.fn(),
    savePublishRecord: vi.fn(),
    configurationId: null as string | null,
    configurationRevisionId: null as string | null,
    currentConfigurationBlockedReason: null as string | null,
  };
}

describe("usePublishRunner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.showSystemNotification.mockResolvedValue(true);
    mocks.preflightPublishOutput.mockResolvedValue({
      outputDir: "/exports/App/Release",
      configuredOutputDir: "/exports/App/Release",
      validation: {
        status: "compatible",
        issue: null,
      },
      access: {
        status: "not_applicable",
        protectedLocation: null,
        protectedRoot: null,
        probeDirectory: null,
        detail: null,
      },
    });
    mocks.requestProtectedOutputAccess.mockImplementation(
      async (_spec, result) => ({
        preflight: result,
        selectedDirectory: null,
      })
    );
    mocks.analyzePublishExecutionFailure.mockReturnValue("process_failed");
    mocks.setTrayPublishStatus.mockResolvedValue(true);
    mocks.renderPublishCommand.mockResolvedValue(createRenderedCommand());
    mocks.preparePublishRuntime.mockImplementation(
      async (request: { configurationRevisionId: string }) =>
        createPreparedRuntime(request.configurationRevisionId)
    );
    mocks.startPublishRuntime.mockImplementation(
      async (request: { runtimeToken: string }) =>
        createRuntimeResult(request.runtimeToken.replace("token-", ""))
    );
    mocks.resumePublishRuntime.mockImplementation(
      async (request: { attemptId: string }) =>
        createRuntimeResult(request.attemptId.replace("attempt-", ""))
    );
    mocks.synchronizePublishRuntime.mockResolvedValue({
      attemptId: "attempt-none",
      acceptedEvents: 0,
      duplicateEvents: 0,
      missingRanges: [],
      result: null,
    });
    mocks.cancelPublishRuntime.mockResolvedValue(true);
    buildPublishSpecMock = vi.fn(() => ({
      version: 1,
      provider_id: "dotnet",
      project_path: "/repo/App.csproj",
      parameters: {
        properties: {
          PublishProfile: "FolderProfile",
        },
      },
    }));

    mocks.useDotnetPublishSelection.mockReturnValue({
      getCurrentConfig: vi.fn(),
      selectionIdentity: projectProfileSelectionIdentity,
      recentConfigKeyForCurrentSelection: "pubxml:FolderProfile",
      isResolvingSelectedProjectProfile: false,
    });

    mocks.usePublishSpecBuilder.mockReturnValue({
      buildPublishSpec: buildPublishSpecMock,
    });
  });

  it("选中 pubxml 时通过 PublishProfile 执行发布", async () => {
    mocks.runEnvironmentCheck.mockResolvedValue(readyEnvironment);
    mocks.invoke.mockResolvedValue(createPublishResult());

    const props = createRunnerProps();
    const { result } = renderHook(() => usePublishRunner(props));

    await act(async () => {
      await result.current.startPublish();
    });

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith("execute_provider_publish", {
        spec: {
          version: 1,
          provider_id: "dotnet",
          project_path: "/repo/App.csproj",
          parameters: {
            properties: {
              PublishProfile: "FolderProfile",
            },
          },
        },
      });
    });

    expect(props.pushRecentConfig).toHaveBeenCalledWith(
      "pubxml:FolderProfile",
      "repo-1"
    );
    expect(props.savePublishRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        repoId: "repo-1",
        providerId: "dotnet",
        projectPath: "/repo/App.csproj",
        success: true,
        outputDir: "/exports/App/Release",
        spec: expect.objectContaining({
          parameters: {
            properties: {
              PublishProfile: "FolderProfile",
            },
          },
        }),
      })
    );
    expect(buildPublishSpecMock).toHaveBeenCalled();
  });

  it("当前配置不兼容时显示原因且不会解析或执行发布", async () => {
    const props = createRunnerProps();
    props.currentConfigurationBlockedReason = "provider_version_unsupported:7";
    const { result } = renderHook(() => usePublishRunner(props));
    const previewBuildCalls = buildPublishSpecMock.mock.calls.length;

    await act(async () => {
      await result.current.startPublish();
    });

    expect(mocks.toast.error).toHaveBeenCalledWith("当前发布配置不可执行", {
      description: "provider_version_unsupported:7",
    });
    expect(buildPublishSpecMock).toHaveBeenCalledTimes(previewBuildCalls);
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "execute_provider_publish",
      expect.anything()
    );
  });

  it("手动 userprofile 发布记录固定当前 profile 与 revision ID", async () => {
    mocks.runEnvironmentCheck.mockResolvedValue(readyEnvironment);
    mocks.invoke.mockResolvedValue(createPublishResult());
    mocks.useDotnetPublishSelection.mockReturnValue({
      getCurrentConfig: vi.fn(),
      selectionIdentity: {
        kind: "user-profile",
        profileId: "profile-42",
        configKey: "userprofile:profile-42",
      },
      recentConfigKeyForCurrentSelection: "userprofile:profile-42",
      isResolvingSelectedProjectProfile: false,
    });

    const props = createRunnerProps();
    props.selectedPreset = "userprofile:profile-42";
    props.isCustomMode = true;
    props.configurationId = "profile-42";
    props.configurationRevisionId = "revision-7";
    const { result } = renderHook(() => usePublishRunner(props));

    await waitFor(() => {
      expect(result.current.preparedRuntime?.configurationRevisionId).toBe(
        "revision-7"
      );
    });

    await act(async () => {
      await result.current.startPublish();
    });

    expect(props.savePublishRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        configurationId: "profile-42",
        configurationRevisionId: "revision-7",
      })
    );
  });

  it("发布成功后自动导出执行快照并写入记录 snapshotPath", async () => {
    mocks.runEnvironmentCheck.mockResolvedValue(readyEnvironment);
    mocks.invoke.mockImplementation(
      async (command: string, args: { filePath?: string }) => {
        if (command === "execute_provider_publish") {
          return createPublishResult();
        }
        if (command === "export_execution_snapshot") {
          return args.filePath;
        }
        throw new Error(`unexpected invoke: ${command}`);
      }
    );

    const props = createRunnerProps();
    const { result } = renderHook(() => usePublishRunner(props));

    await act(async () => {
      await result.current.startPublish();
    });

    expect(mocks.invoke).toHaveBeenCalledWith(
      "export_execution_snapshot",
      expect.objectContaining({
        filePath: expect.stringMatching(
          /^\/exports\/App\/Release\/execution-snapshot-.+\.md$/
        ),
        snapshot: expect.objectContaining({
          providerId: "dotnet",
          output: expect.objectContaining({
            log: expect.stringContaining("Build succeeded."),
          }),
        }),
      })
    );
    expect(props.savePublishRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        snapshotPath: expect.stringMatching(/execution-snapshot-.+\.md$/),
      })
    );
  });

  it("快照导出失败时记录仍保存且 snapshotPath 为 null", async () => {
    mocks.runEnvironmentCheck.mockResolvedValue(readyEnvironment);
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "execute_provider_publish") {
        return createPublishResult();
      }
      throw new Error("disk full");
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const props = createRunnerProps();
    const { result } = renderHook(() => usePublishRunner(props));

    await act(async () => {
      await result.current.startPublish();
    });

    expect(props.savePublishRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        snapshotPath: null,
      })
    );
    expect(mocks.toast.success).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("执行结果优先使用后端返回的命令与最终日志写入历史", async () => {
    mocks.runEnvironmentCheck.mockResolvedValue(readyEnvironment);
    mocks.invoke.mockResolvedValue(
      createPublishResult({
        success: false,
        error: "发布失败，退出代码: Some(1)",
        command: createRenderedCommand(
          'dotnet publish "/repo/App.csproj" -c Release -o "/exports/App/Release"'
        ),
        output_log: [
          '$ dotnet publish "/repo/App.csproj" -c Release -o "/exports/App/Release"',
          "[stderr] CSC : error CS0246: The type or namespace name 'Foo' could not be found",
          "[stderr] Build FAILED.",
        ].join("\n"),
        output_dir: "",
        file_count: 0,
      })
    );

    const props = createRunnerProps();
    const { result } = renderHook(() => usePublishRunner(props));

    await act(async () => {
      await result.current.startPublish();
    });

    expect(props.savePublishRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        commandLine:
          '$ dotnet publish "/repo/App.csproj" -c Release -o "/exports/App/Release"',
        outputExcerpt: expect.stringContaining("Build FAILED."),
        error:
          "[stderr] CSC : error CS0246: The type or namespace name 'Foo' could not be found",
      })
    );
  });

  it("环境阻断时不执行发布并打开环境弹窗", async () => {
    mocks.runEnvironmentCheck.mockResolvedValue({
      ...readyEnvironment,
      is_ready: false,
      issues: [
        {
          severity: "critical",
          provider_id: "dotnet",
          issue_type: "missing_tool",
          description: ".NET SDK missing",
          fixes: [],
        },
      ],
    });
    mocks.invoke.mockResolvedValue(
      createPublishResult({
        file_count: 0,
      })
    );

    const props = createRunnerProps();
    const { result } = renderHook(() => usePublishRunner(props));

    await act(async () => {
      await result.current.startPublish();
    });

    expect(props.openEnvironmentDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        providerIds: ["dotnet"],
        result: expect.objectContaining({
          is_ready: false,
        }),
      }),
      ["dotnet"]
    );
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(props.savePublishRecord).not.toHaveBeenCalled();
  });

  it("环境检查失败时不会继续执行发布", async () => {
    mocks.runEnvironmentCheck.mockRejectedValue(new Error("env boom"));
    mocks.invoke.mockResolvedValue(
      createPublishResult({
        file_count: 0,
      })
    );

    const props = createRunnerProps();
    const { result } = renderHook(() => usePublishRunner(props));

    await act(async () => {
      await result.current.runPublishSpec(
        {
          version: 1,
          provider_id: "dotnet",
          project_path: "/repo/App.csproj",
          parameters: {
            configuration: "Release",
          },
        },
        {
          repoId: "repo-1",
          recentConfigKey: "pubxml:FolderProfile",
          restoreWindowOnFailure: true,
        }
      );
    });

    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(props.savePublishRecord).not.toHaveBeenCalled();
    expect(mocks.showMainWindow).toHaveBeenCalled();
    expect(mocks.toast.error).toHaveBeenCalledWith("环境检查失败", {
      description: "env boom",
    });
  });

  it("macOS 受保护目录权限不足时阻止发布", async () => {
    mocks.runEnvironmentCheck.mockResolvedValue(readyEnvironment);
    mocks.preflightPublishOutput.mockResolvedValue({
      outputDir: "/Users/test/Downloads/publish/App/Release",
      configuredOutputDir: "/Users/test/Downloads/publish/App/Release",
      validation: {
        status: "compatible",
        issue: null,
      },
      access: {
        status: "denied",
        protectedLocation: "downloads",
        protectedRoot: "/Users/test/Downloads",
        probeDirectory: "/Users/test/Downloads/publish",
        detail: "Operation not permitted",
      },
    });

    const props = createRunnerProps();
    const { result } = renderHook(() => usePublishRunner(props));

    await act(async () => {
      await result.current.startPublish();
    });

    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(props.savePublishRecord).not.toHaveBeenCalled();
    expect(mocks.showMainWindow).toHaveBeenCalled();
    expect(mocks.requestProtectedOutputAccess).toHaveBeenCalled();
    expect(mocks.toast.error).toHaveBeenCalledWith(
      "缺少 macOS 受保护目录访问权限",
      {
        description: "需要授权 Downloads",
      }
    );
  });

  it("macOS 受保护目录授权成功后继续发布", async () => {
    mocks.runEnvironmentCheck.mockResolvedValue(readyEnvironment);
    const deniedPreflight = {
      outputDir: "/Users/test/Downloads/publish/App/Release",
      configuredOutputDir: "/Users/test/Downloads/publish/App/Release",
      validation: {
        status: "compatible",
        issue: null,
      },
      access: {
        status: "denied",
        protectedLocation: "downloads",
        protectedRoot: "/Users/test/Downloads",
        probeDirectory: "/Users/test/Downloads/publish/App",
        detail: "Operation not permitted",
      },
    };
    mocks.preflightPublishOutput.mockResolvedValue(deniedPreflight);
    mocks.requestProtectedOutputAccess.mockResolvedValue({
      preflight: {
        ...deniedPreflight,
        access: {
          status: "granted",
          protectedLocation: "downloads",
          protectedRoot: "/Users/test/Downloads",
          probeDirectory: "/Users/test/Downloads/publish/App",
          detail: null,
        },
      },
      selectedDirectory: "/Users/test/Downloads/publish/App",
    });
    mocks.invoke.mockResolvedValue(createPublishResult());

    const props = createRunnerProps();
    const { result } = renderHook(() => usePublishRunner(props));

    await act(async () => {
      await result.current.startPublish();
    });

    expect(mocks.showMainWindow).toHaveBeenCalled();
    expect(mocks.requestProtectedOutputAccess).toHaveBeenCalledWith(
      {
        version: 1,
        provider_id: "dotnet",
        project_path: "/repo/App.csproj",
        parameters: {
          properties: {
            PublishProfile: "FolderProfile",
          },
        },
      },
      deniedPreflight,
      props.appT
    );
    expect(mocks.invoke).toHaveBeenCalledWith("execute_provider_publish", {
      spec: {
        version: 1,
        provider_id: "dotnet",
        project_path: "/repo/App.csproj",
        parameters: {
          properties: {
            PublishProfile: "FolderProfile",
          },
        },
      },
    });
    expect(props.savePublishRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        outputDir: "/exports/App/Release",
      })
    );
  });

  it("执行阶段受保护目录错误授权后只重试一次并写入成功记录", async () => {
    mocks.runEnvironmentCheck.mockResolvedValue(readyEnvironment);
    const grantedPreflight = {
      outputDir: "/Users/test/Downloads/publish/App/Release",
      configuredOutputDir: "/Users/test/Downloads/publish/App/Release",
      validation: {
        status: "compatible",
        issue: null,
      },
      access: {
        status: "granted",
        protectedLocation: "downloads",
        protectedRoot: "/Users/test/Downloads",
        probeDirectory: "/Users/test/Downloads/publish/App",
        detail: null,
      },
    };
    mocks.preflightPublishOutput.mockResolvedValue(grantedPreflight);
    mocks.requestProtectedOutputAccess.mockResolvedValue({
      preflight: grantedPreflight,
      selectedDirectory: "/Users/test/Downloads/publish/App",
    });
    mocks.analyzePublishExecutionFailure.mockReturnValue(
      "protected_directory_access_denied"
    );
    mocks.invoke
      .mockRejectedValueOnce(
        new Error(
          "publish output directory requires macOS protected folder access (Downloads): /Users/test/Downloads/publish/App/Release | Operation not permitted"
        )
      )
      .mockResolvedValueOnce(createPublishResult());

    const props = createRunnerProps();
    const { result } = renderHook(() => usePublishRunner(props));

    await act(async () => {
      await result.current.startPublish();
    });

    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "execute_provider_publish"
      )
    ).toHaveLength(2);
    expect(mocks.requestProtectedOutputAccess).toHaveBeenCalledWith(
      {
        version: 1,
        provider_id: "dotnet",
        project_path: "/repo/App.csproj",
        parameters: {
          properties: {
            PublishProfile: "FolderProfile",
          },
        },
      },
      grantedPreflight,
      props.appT
    );
    expect(mocks.showMainWindow).toHaveBeenCalled();
    expect(props.savePublishRecord).toHaveBeenCalledTimes(1);
    expect(props.savePublishRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        outputDir: "/exports/App/Release",
      })
    );
  });

  it("MSBuild 进程输出受保护目录错误时授权后重试发布", async () => {
    mocks.runEnvironmentCheck.mockResolvedValue(readyEnvironment);
    const grantedPreflight = {
      outputDir: "/Users/test/Downloads/publish/App/Debug",
      configuredOutputDir: "/Users/test/Downloads/publish/App/Debug",
      validation: {
        status: "compatible",
        issue: null,
      },
      access: {
        status: "granted",
        protectedLocation: "downloads",
        protectedRoot: "/Users/test/Downloads",
        probeDirectory: "/Users/test/Downloads/publish/App",
        detail: null,
      },
    };
    mocks.preflightPublishOutput.mockResolvedValue(grantedPreflight);
    mocks.requestProtectedOutputAccess.mockResolvedValue({
      preflight: grantedPreflight,
      selectedDirectory: "/Users/test/Downloads/publish/App",
    });
    mocks.invoke
      .mockResolvedValueOnce(
        createPublishResult({
          success: false,
          error: "发布失败，退出代码: Some(1)",
          output_log: [
            '$ dotnet publish "/repo/App.csproj"',
            '/repo/App.csproj(79,3): error MSB3021: Unable to copy file "/Users/test/.nuget/packages/hip.core/2.7.2.1/lib/net8.0/HiP.Core.xml" to "/Users/test/Downloads/publish/App/Debug/../HiP.Core.xml".',
            "Access to the path '/Users/test/Downloads/publish/App/HiP.Core.xml' is denied.",
          ].join("\n"),
          output_dir: "",
          file_count: 0,
        })
      )
      .mockResolvedValueOnce(createPublishResult());

    const props = createRunnerProps();
    const { result } = renderHook(() => usePublishRunner(props));

    await act(async () => {
      await result.current.startPublish();
    });

    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "execute_provider_publish"
      )
    ).toHaveLength(2);
    expect(mocks.requestProtectedOutputAccess).toHaveBeenCalledWith(
      {
        version: 1,
        provider_id: "dotnet",
        project_path: "/repo/App.csproj",
        parameters: {
          properties: {
            PublishProfile: "FolderProfile",
          },
        },
      },
      grantedPreflight,
      props.appT
    );
    expect(props.savePublishRecord).toHaveBeenCalledTimes(1);
    expect(props.savePublishRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        outputDir: "/exports/App/Release",
      })
    );
  });

  it("发布目录路径与当前系统不兼容时阻止发布", async () => {
    mocks.runEnvironmentCheck.mockResolvedValue(readyEnvironment);
    mocks.preflightPublishOutput.mockResolvedValue({
      outputDir: "/repo/publish\\win-x64",
      configuredOutputDir: ".\\publish\\win-x64",
      validation: {
        status: "incompatible",
        issue: "windows_style_path_on_posix",
      },
      access: {
        status: "skipped",
        protectedLocation: null,
        protectedRoot: null,
        probeDirectory: null,
        detail: null,
      },
    });

    const props = createRunnerProps();
    const { result } = renderHook(() => usePublishRunner(props));

    await act(async () => {
      await result.current.startPublish();
    });

    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(props.savePublishRecord).not.toHaveBeenCalled();
    expect(mocks.toast.error).toHaveBeenCalledWith(
      "发布目录路径与当前系统不兼容",
      {
        description: "路径与当前系统不兼容",
      }
    );
  });

  it("发布目录指向不存在的 Windows 盘符时阻止发布", async () => {
    mocks.runEnvironmentCheck.mockResolvedValue(readyEnvironment);
    mocks.preflightPublishOutput.mockResolvedValue({
      outputDir: "D:\\PRD",
      configuredOutputDir: "D:\\PRD",
      validation: {
        status: "incompatible",
        issue: "windows_drive_root_missing",
      },
      access: {
        status: "skipped",
        protectedLocation: null,
        protectedRoot: null,
        probeDirectory: null,
        detail: null,
      },
    });

    const props = createRunnerProps();
    const { result } = renderHook(() => usePublishRunner(props));

    await act(async () => {
      await result.current.startPublish();
    });

    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(props.savePublishRecord).not.toHaveBeenCalled();
    expect(mocks.toast.error).toHaveBeenCalledWith("发布目录无效", {
      description: "发布目录指向不存在的 Windows 盘符",
    });
  });

  it("发布失败时仍然写入失败记录", async () => {
    mocks.runEnvironmentCheck.mockResolvedValue(readyEnvironment);
    mocks.invoke.mockRejectedValue(new Error("boom"));

    const props = createRunnerProps();
    props.selectedPreset = "release-fd";
    const buildPublishSpec = vi.fn(() => ({
      version: 1,
      provider_id: "dotnet",
      project_path: "/repo/App.csproj",
      parameters: {
        configuration: "Debug",
      },
    }));
    mocks.usePublishSpecBuilder.mockReturnValue({
      buildPublishSpec,
    });
    mocks.useDotnetPublishSelection.mockReturnValue({
      getCurrentConfig: vi.fn(),
      selectionIdentity: presetSelectionIdentity,
      recentConfigKeyForCurrentSelection: "preset:release-fd",
      isResolvingSelectedProjectProfile: false,
    });

    const { result } = renderHook(() => usePublishRunner(props));

    await act(async () => {
      await result.current.startPublish();
    });

    await waitFor(() => {
      expect(props.savePublishRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: "boom",
          spec: expect.objectContaining({
            parameters: {
              configuration: "Debug",
            },
          }),
        })
      );
    });

    expect(buildPublishSpec).toHaveBeenCalled();
    expect(mocks.toast.error).toHaveBeenCalledWith("发布失败", {
      description: "boom",
    });
  });

  it("系统通知模式成功时自动打开输出目录且不显示 toast", async () => {
    mocks.runEnvironmentCheck.mockResolvedValue(readyEnvironment);
    mocks.invoke.mockResolvedValue(createPublishResult());
    mocks.openOutputDirectory.mockResolvedValue("/exports/App/Release");

    const props = createRunnerProps();
    const { result } = renderHook(() => usePublishRunner(props));

    await act(async () => {
      await result.current.runPublishSpec(
        {
          version: 1,
          provider_id: "dotnet",
          project_path: "/repo/App.csproj",
          parameters: {
            configuration: "Release",
            output: "/exports/App/Release",
          },
        },
        {
          repoId: "repo-2",
          recentConfigKey: "userprofile:beta",
          openOutputDirOnSuccess: true,
          feedbackMode: "system",
        }
      );
    });

    expect(props.pushRecentConfig).toHaveBeenCalledWith(
      "userprofile:beta",
      "repo-2"
    );
    expect(mocks.openOutputDirectory).toHaveBeenCalledWith(
      "/exports/App/Release"
    );
    expect(mocks.showSystemNotification).toHaveBeenCalledWith({
      title: "发布成功",
      body: "输出目录: /exports/App/Release",
    });
    expect(mocks.toast.success).not.toHaveBeenCalled();
    expect(props.savePublishRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        repoId: "repo-2",
        outputDir: "/exports/App/Release",
      })
    );
  });

  it("tray 路径成功时会显示发布成功状态文字", async () => {
    mocks.runEnvironmentCheck.mockResolvedValue(readyEnvironment);
    mocks.invoke.mockResolvedValue(createPublishResult());

    const props = createRunnerProps();
    const { result } = renderHook(() => usePublishRunner(props));

    await act(async () => {
      await result.current.runPublishSpec(
        {
          version: 1,
          provider_id: "dotnet",
          project_path: "/repo/App.csproj",
          parameters: {
            configuration: "Release",
          },
        },
        {
          repoId: "repo-1",
          recentConfigKey: "pubxml:FolderProfile",
          feedbackMode: "system",
          trayStatusEffect: true,
        }
      );
    });

    expect(mocks.setTrayPublishStatus).toHaveBeenCalledWith("success");
  });

  it("系统通知模式失败时不拉起主窗口并发送失败详情", async () => {
    mocks.runEnvironmentCheck.mockResolvedValue(readyEnvironment);
    mocks.invoke.mockResolvedValue(
      createPublishResult({
        success: false,
        error: "publish failed",
        output_log:
          '$ dotnet publish "/repo/App.csproj"\n[stderr] publish failed\n',
        output_dir: "",
        file_count: 0,
      })
    );

    const props = createRunnerProps();
    const { result } = renderHook(() => usePublishRunner(props));

    await act(async () => {
      await result.current.runPublishSpec(
        {
          version: 1,
          provider_id: "dotnet",
          project_path: "/repo/App.csproj",
          parameters: {
            configuration: "Release",
          },
        },
        {
          repoId: "repo-1",
          recentConfigKey: "pubxml:FolderProfile",
          feedbackMode: "system",
          restoreWindowOnFailure: false,
        }
      );
    });

    expect(mocks.showSystemNotification).toHaveBeenCalledWith({
      title: "发布失败",
      body: "publish failed",
    });
    expect(mocks.showMainWindow).not.toHaveBeenCalled();
    expect(mocks.toast.error).not.toHaveBeenCalledWith("发布失败", {
      description: "publish failed",
    });
  });

  it("系统通知发送失败时会回退拉起主窗口暴露错误", async () => {
    mocks.runEnvironmentCheck.mockResolvedValue(readyEnvironment);
    mocks.invoke.mockResolvedValue(
      createPublishResult({
        success: false,
        error: "publish failed",
        output_log:
          '$ dotnet publish "/repo/App.csproj"\n[stderr] publish failed\n',
        output_dir: "",
        file_count: 0,
      })
    );
    mocks.showSystemNotification.mockResolvedValue(false);

    const props = createRunnerProps();
    const { result } = renderHook(() => usePublishRunner(props));

    await act(async () => {
      await result.current.runPublishSpec(
        {
          version: 1,
          provider_id: "dotnet",
          project_path: "/repo/App.csproj",
          parameters: {
            configuration: "Release",
          },
        },
        {
          repoId: "repo-1",
          recentConfigKey: "pubxml:FolderProfile",
          feedbackMode: "system",
          restoreWindowOnFailure: false,
        }
      );
    });

    expect(mocks.showMainWindow).toHaveBeenCalled();
    expect(mocks.toast.error).toHaveBeenCalledWith("发布失败", {
      description: "publish failed",
    });
  });

  it("tray 路径前置检查失败时会显示发布失败状态文字", async () => {
    mocks.runEnvironmentCheck.mockRejectedValue(new Error("env boom"));

    const props = createRunnerProps();
    const { result } = renderHook(() => usePublishRunner(props));

    await act(async () => {
      await result.current.runPublishSpec(
        {
          version: 1,
          provider_id: "dotnet",
          project_path: "/repo/App.csproj",
          parameters: {
            configuration: "Release",
          },
        },
        {
          repoId: "repo-1",
          recentConfigKey: "pubxml:FolderProfile",
          feedbackMode: "system",
          trayStatusEffect: true,
        }
      );
    });

    expect(mocks.setTrayPublishStatus).toHaveBeenCalledWith("failure");
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("切换仓库或发布配置时会清空右栏发布展示态", async () => {
    mocks.runEnvironmentCheck.mockResolvedValue(readyEnvironment);
    mocks.invoke.mockResolvedValue(createPublishResult());

    const props = createRunnerProps();
    const { result, rerender } = renderHook(
      (hookProps: ReturnType<typeof createRunnerProps>) =>
        usePublishRunner(hookProps),
      {
        initialProps: props,
      }
    );

    await act(async () => {
      await result.current.runPublishSpec(
        {
          version: 1,
          provider_id: "dotnet",
          project_path: "/repo/App.csproj",
          parameters: {
            configuration: "Release",
          },
        },
        {
          repoId: "repo-1",
          recentConfigKey: "pubxml:FolderProfile",
        }
      );
    });

    await waitFor(() => {
      expect(usePublishStore.getState().publishResult).toEqual(
        expect.objectContaining({
          success: true,
          output_dir: "/exports/App/Release",
        })
      );
      expect(usePublishStore.getState().lastPublishSpec).toEqual(
        expect.objectContaining({
          project_path: "/repo/App.csproj",
        })
      );
    });

    rerender({
      ...props,
      selectedRepoId: "repo-2",
      selectedRepo: { path: "/repo-b" },
      selectedPreset: "release-fd",
    });

    await waitFor(() => {
      expect(usePublishStore.getState().publishResult).toBeNull();
      expect(usePublishStore.getState().lastPublishSpec).toBeNull();
      expect(usePublishStore.getState().currentPublishRecordId).toBeNull();
      expect(result.current.outputLog).toBe("");
    });
  });

  it("编辑自定义发布参数时保留当前右栏发布展示态", async () => {
    mocks.runEnvironmentCheck.mockResolvedValue(readyEnvironment);
    mocks.invoke.mockResolvedValue(createPublishResult());

    const props = createRunnerProps();
    props.isCustomMode = true;
    props.selectedPreset = "release-fd";
    mocks.useDotnetPublishSelection.mockReturnValue({
      getCurrentConfig: vi.fn(),
      selectionIdentity: customSelectionIdentity,
      recentConfigKeyForCurrentSelection: null,
      isResolvingSelectedProjectProfile: false,
    });

    const { result, rerender } = renderHook(
      (hookProps: ReturnType<typeof createRunnerProps>) =>
        usePublishRunner(hookProps),
      {
        initialProps: props,
      }
    );

    await act(async () => {
      await result.current.runPublishSpec(
        {
          version: 1,
          provider_id: "dotnet",
          project_path: "/repo/App.csproj",
          parameters: {
            configuration: "Release",
          },
        },
        {
          repoId: "repo-1",
        }
      );
    });

    await waitFor(() => {
      expect(usePublishStore.getState().publishResult).toEqual(
        expect.objectContaining({
          success: true,
          output_dir: "/exports/App/Release",
        })
      );
    });

    rerender({
      ...props,
      customConfig: {
        ...props.customConfig,
        outputDir: "/exports/App/Custom",
      },
    });

    await waitFor(() => {
      expect(usePublishStore.getState().publishResult).toEqual(
        expect.objectContaining({
          success: true,
          output_dir: "/exports/App/Release",
        })
      );
      expect(usePublishStore.getState().lastPublishSpec).toEqual(
        expect.objectContaining({
          project_path: "/repo/App.csproj",
        })
      );
      expect(result.current.outputLog).toContain("Build succeeded.");
    });
  });

  it("concurrent_runPublishSpec_is_rejected_before_any_side_effect", async () => {
    mocks.runEnvironmentCheck.mockResolvedValue(readyEnvironment);
    mocks.invoke.mockResolvedValue(createPublishResult());

    const props = createRunnerProps();
    const { result } = renderHook(() => usePublishRunner(props));

    usePublishStore.getState().setIsPublishing(true);

    await act(async () => {
      await result.current.runPublishSpec(
        {
          version: 1,
          provider_id: "dotnet",
          project_path: "/repo/App.csproj",
          parameters: {
            configuration: "Release",
          },
        },
        {
          repoId: "repo-1",
          recentConfigKey: "pubxml:FolderProfile",
        }
      );
    });

    expect(mocks.runEnvironmentCheck).not.toHaveBeenCalled();
    expect(mocks.preflightPublishOutput).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(props.pushRecentConfig).not.toHaveBeenCalled();
    expect(props.savePublishRecord).not.toHaveBeenCalled();
    // 守卫在任何副作用之前 return，finally 未执行，不消费调用方的 isPublishing 状态
    expect(usePublishStore.getState().isPublishing).toBe(true);

    usePublishStore.getState().setIsPublishing(false);
  });

  it("切换选中配置只更新下一次手动执行，不改变已经启动的 Attempt", async () => {
    mocks.runEnvironmentCheck.mockResolvedValue(readyEnvironment);
    mocks.useDotnetPublishSelection.mockReturnValue({
      getCurrentConfig: vi.fn(),
      selectionIdentity: {
        kind: "user-profile",
        profileId: "profile-42",
        configKey: "userprofile:profile-42",
      },
      recentConfigKeyForCurrentSelection: "userprofile:profile-42",
      isResolvingSelectedProjectProfile: false,
    });
    let resolveAttemptA: (
      value: ReturnType<typeof createRuntimeResult>
    ) => void = () => {};
    mocks.startPublishRuntime.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAttemptA = resolve;
        })
    );

    const props = createRunnerProps();
    props.isCustomMode = true;
    props.selectedPreset = "userprofile:profile-42";
    props.configurationId = "profile-42";
    props.configurationRevisionId = "revision-A";
    const { result, rerender } = renderHook(
      (hookProps: ReturnType<typeof createRunnerProps>) =>
        usePublishRunner(hookProps),
      { initialProps: props }
    );

    await waitFor(() => {
      expect(result.current.preparedRuntime?.configurationRevisionId).toBe(
        "revision-A"
      );
    });

    let attemptA: Promise<void> | undefined;
    act(() => {
      attemptA = result.current.startPublish();
    });
    await waitFor(() => {
      expect(mocks.startPublishRuntime).toHaveBeenCalledWith({
        runtimeToken: "token-revision-A",
      });
      expect(result.current.activeRuntime?.configurationRevisionId).toBe(
        "revision-A"
      );
    });

    rerender({
      ...props,
      configurationRevisionId: "revision-B",
    });
    await waitFor(() => {
      expect(result.current.preparedRuntime?.configurationRevisionId).toBe(
        "revision-B"
      );
      expect(result.current.activeRuntime?.configurationRevisionId).toBe(
        "revision-A"
      );
    });

    await act(async () => {
      resolveAttemptA(createRuntimeResult("revision-A"));
      await attemptA;
    });
    expect(result.current.runtimeResult?.attempt.configurationRevisionId).toBe(
      "revision-A"
    );

    await act(async () => {
      await result.current.startPublish();
    });
    expect(mocks.startPublishRuntime).toHaveBeenLastCalledWith({
      runtimeToken: "token-revision-B",
    });
    expect(result.current.activeRuntime?.configurationRevisionId).toBe(
      "revision-B"
    );
  });

  it("同一 revision 的单次运行输入变化会立即使旧 Runtime 令牌失效", async () => {
    mocks.runEnvironmentCheck.mockResolvedValue(readyEnvironment);
    let currentOutput = "/exports/App/A";
    buildPublishSpecMock = vi.fn(() => ({
      version: 1,
      provider_id: "dotnet",
      project_path: "/repo/App.csproj",
      parameters: {
        configuration: "Release",
        output: currentOutput,
      },
    }));
    mocks.usePublishSpecBuilder.mockReturnValue({
      buildPublishSpec: buildPublishSpecMock,
    });
    mocks.preparePublishRuntime
      .mockResolvedValueOnce(createPreparedRuntime("revision-A"))
      .mockImplementationOnce(() => new Promise(() => {}));

    const props = createRunnerProps();
    props.configurationId = "profile-42";
    props.configurationRevisionId = "revision-A";
    const { result, rerender } = renderHook(
      (hookProps: ReturnType<typeof createRunnerProps>) =>
        usePublishRunner(hookProps),
      { initialProps: props }
    );

    await waitFor(() => {
      expect(result.current.preparedRuntime?.runtimeToken).toBe(
        "token-revision-A"
      );
    });

    currentOutput = "/exports/App/B";
    rerender({
      ...props,
      selectedRepo: { path: "/repo" },
    });

    expect(result.current.preparedRuntime).toBeNull();
    await act(async () => {
      await result.current.startPublish();
    });
    expect(mocks.startPublishRuntime).not.toHaveBeenCalled();
  });

  it("Runtime 准备失败展示 Tauri 结构化错误消息", async () => {
    mocks.preparePublishRuntime.mockRejectedValue({
      code: "publish_runtime_source_changed",
      message: "source changed since preparation",
    });
    const props = createRunnerProps();
    props.configurationId = "profile-42";
    props.configurationRevisionId = "revision-A";

    const { result } = renderHook(() => usePublishRunner(props));

    await waitFor(() => {
      expect(result.current.runtimePreparationError).toBe(
        "source changed since preparation"
      );
    });
  });

  it("新的 legacy 手动执行会替换之前的 Runtime 结果", async () => {
    mocks.runEnvironmentCheck.mockResolvedValue(readyEnvironment);
    const props = createRunnerProps();
    props.configurationId = "profile-42";
    props.configurationRevisionId = "revision-A";
    const { result, rerender } = renderHook(
      (hookProps: ReturnType<typeof createRunnerProps>) =>
        usePublishRunner(hookProps),
      { initialProps: props }
    );

    await waitFor(() => {
      expect(result.current.preparedRuntime?.runtimeToken).toBe(
        "token-revision-A"
      );
    });
    await act(async () => {
      await result.current.startPublish();
    });
    expect(result.current.runtimeResult?.attempt.status).toBe("published");

    rerender({
      ...props,
      configurationId: null,
      configurationRevisionId: null,
    });
    mocks.invoke.mockRejectedValueOnce(new Error("legacy provider failed"));
    await act(async () => {
      await result.current.runPublishSpec({
        version: 1,
        provider_id: "dotnet",
        project_path: "/repo/App.csproj",
        parameters: { configuration: "Release" },
      });
    });

    expect(result.current.activeRuntime).toBeNull();
    expect(result.current.runtimeResult).toBeNull();
    expect(usePublishStore.getState().publishResult).toEqual(
      expect.objectContaining({
        success: false,
        error: "legacy provider failed",
      })
    );
  });

  it("预检阻断不会把尚未启动的 Runtime 标记为当前 Attempt", async () => {
    mocks.runEnvironmentCheck.mockResolvedValue({
      ...readyEnvironment,
      is_ready: false,
      issues: [
        {
          severity: "critical",
          provider_id: "dotnet",
          issue_type: "missing_tool",
          description: ".NET SDK missing",
          fixes: [],
        },
      ],
    });
    const props = createRunnerProps();
    props.configurationId = "profile-42";
    props.configurationRevisionId = "revision-A";
    const { result } = renderHook(() => usePublishRunner(props));

    await waitFor(() => {
      expect(result.current.preparedRuntime?.runtimeToken).toBe(
        "token-revision-A"
      );
    });
    await act(async () => {
      await result.current.startPublish();
    });

    expect(mocks.startPublishRuntime).not.toHaveBeenCalled();
    expect(mocks.preflightPublishOutput).not.toHaveBeenCalled();
    expect(mocks.requestProtectedOutputAccess).not.toHaveBeenCalled();
    expect(result.current.activeRuntime).toBeNull();
    expect(result.current.runtimeResult).toBeNull();
  });

  it("isPublishing_set_during_preflight", async () => {
    let resolveEnvironmentCheck: (
      value: EnvironmentCheckResult
    ) => void = () => {};
    mocks.runEnvironmentCheck.mockImplementation(
      () =>
        new Promise<EnvironmentCheckResult>((resolve) => {
          resolveEnvironmentCheck = resolve;
        })
    );

    const props = createRunnerProps();
    const { result } = renderHook(() => usePublishRunner(props));

    let publishPromise: Promise<void> | undefined;
    act(() => {
      publishPromise = result.current.runPublishSpec(
        {
          version: 1,
          provider_id: "dotnet",
          project_path: "/repo/App.csproj",
          parameters: {
            configuration: "Release",
          },
        },
        {
          repoId: "repo-1",
          recentConfigKey: "pubxml:FolderProfile",
        }
      );
    });

    // preflight 仍 pending，isPublishing 已在第一个 await 之前置位
    expect(usePublishStore.getState().isPublishing).toBe(true);

    await act(async () => {
      resolveEnvironmentCheck({
        ...readyEnvironment,
        is_ready: false,
        issues: [
          {
            severity: "critical",
            provider_id: "dotnet",
            issue_type: "missing_tool",
            description: ".NET SDK missing",
            fixes: [],
          },
        ],
      });
      await publishPromise;
    });

    // preflight 拒绝（环境阻断）后早退路径复位
    expect(usePublishStore.getState().isPublishing).toBe(false);
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(props.savePublishRecord).not.toHaveBeenCalled();
  });

  it("预检期间取消会阻止尚未接受的 Runtime 启动", async () => {
    let resolveEnvironmentCheck: (
      value: EnvironmentCheckResult
    ) => void = () => {};
    mocks.runEnvironmentCheck.mockImplementation(
      () =>
        new Promise<EnvironmentCheckResult>((resolve) => {
          resolveEnvironmentCheck = resolve;
        })
    );
    const props = createRunnerProps();
    const { result } = renderHook(() => usePublishRunner(props));
    const spec = {
      version: 1,
      provider_id: "dotnet",
      project_path: "/repo/App.csproj",
      parameters: { configuration: "Release" },
    };
    let publishPromise: Promise<void> | undefined;

    act(() => {
      publishPromise = result.current.runPublishSpec(
        spec,
        { repoId: "repo-1" },
        createPreparedRuntime("revision-cancelled-before-start")
      );
    });
    expect(usePublishStore.getState().isPublishing).toBe(true);

    await act(async () => {
      await result.current.cancelPublish();
    });
    expect(usePublishStore.getState().isPublishing).toBe(false);
    expect(mocks.invoke).not.toHaveBeenCalledWith("cancel_provider_publish");

    await act(async () => {
      resolveEnvironmentCheck(readyEnvironment);
      await publishPromise;
    });

    expect(mocks.startPublishRuntime).not.toHaveBeenCalled();
    expect(mocks.preflightPublishOutput).not.toHaveBeenCalled();
    expect(mocks.requestProtectedOutputAccess).not.toHaveBeenCalled();
    expect(result.current.activeRuntime).toBeNull();
    expect(result.current.runtimeResult).toBeNull();
  });

  it("Runtime 执行期间通过密封令牌请求协作取消", async () => {
    mocks.runEnvironmentCheck.mockResolvedValue(readyEnvironment);
    let resolveRuntime: (value: PublishRuntimeResult) => void = () => {};
    mocks.startPublishRuntime.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRuntime = resolve;
        })
    );
    const props = createRunnerProps();
    const { result } = renderHook(() => usePublishRunner(props));
    let publishPromise: Promise<void> | undefined;

    act(() => {
      publishPromise = result.current.runPublishSpec(
        {
          version: 1,
          provider_id: "dotnet",
          project_path: "/repo/App.csproj",
          parameters: { configuration: "Release" },
        },
        { repoId: "repo-1" },
        createPreparedRuntime("revision-runtime-cancel")
      );
    });
    await waitFor(() => {
      expect(mocks.startPublishRuntime).toHaveBeenCalledWith({
        runtimeToken: "token-revision-runtime-cancel",
      });
    });

    await act(async () => {
      await result.current.cancelPublish();
    });
    expect(mocks.cancelPublishRuntime).toHaveBeenCalledWith({
      runtimeToken: "token-revision-runtime-cancel",
    });
    expect(mocks.invoke).not.toHaveBeenCalledWith("cancel_provider_publish");

    await act(async () => {
      const completed = createRuntimeResult("revision-runtime-cancel");
      const cancelledRuntime: PublishRuntimeResult = {
        ...completed,
        attempt: {
          ...completed.attempt,
          status: "cancelled",
          manifestDigest: null,
          manifest: null,
          receipts: [],
          events: [],
          error: null,
        },
        publishResult: null,
      };
      resolveRuntime(cancelledRuntime);
      await publishPromise;
    });
    expect(usePublishStore.getState().publishResult?.cancelled).toBe(true);
  });

  it("Submitted 后保留 Attempt，并按 Attempt ID 取消及同步终态", async () => {
    mocks.runEnvironmentCheck.mockResolvedValue(readyEnvironment);
    const completed = createRuntimeResult("revision-runtime-submitted");
    const submittedRuntime: PublishRuntimeResult = {
      ...completed,
      attempt: {
        ...completed.attempt,
        status: "running",
        receipts: completed.attempt.receipts.map((receipt) => ({
          ...receipt,
          status: "submitted",
        })),
        routes: completed.attempt.routes.map((route) => ({
          ...route,
          status: "submitted",
        })),
      },
    };
    mocks.startPublishRuntime.mockResolvedValueOnce(submittedRuntime);
    const props = createRunnerProps();
    props.configurationRevisionId = "revision-runtime-submitted";
    const { result } = renderHook(() => usePublishRunner(props));

    await act(async () => {
      await result.current.runPublishSpec(
        {
          version: 1,
          provider_id: "dotnet",
          project_path: "/repo/App.csproj",
          parameters: { configuration: "Release" },
        },
        { repoId: "repo-1" },
        createPreparedRuntime("revision-runtime-submitted")
      );
    });

    expect(result.current.runtimeResult?.attempt.status).toBe("running");
    expect(usePublishStore.getState().isPublishing).toBe(false);
    expect(usePublishStore.getState().publishResult).toBeNull();
    expect(usePublishStore.getState().currentPublishRecordId).toBeNull();

    mocks.synchronizePublishRuntime.mockResolvedValueOnce({
      attemptId: submittedRuntime.attempt.attemptId,
      acceptedEvents: 0,
      duplicateEvents: 0,
      missingRanges: [],
      result: completed,
    });
    await act(async () => {
      await result.current.cancelPublish();
    });

    expect(mocks.cancelPublishRuntime).toHaveBeenCalledWith({
      attemptId: submittedRuntime.attempt.attemptId,
    });
    expect(mocks.synchronizePublishRuntime).toHaveBeenLastCalledWith({
      repositoryPath: "/repo",
      configurationRevisionId: "revision-runtime-submitted",
      attemptId: submittedRuntime.attempt.attemptId,
      events: [],
    });
    expect(result.current.runtimeResult?.attempt.status).toBe("published");
  });

  it("Running Attempt 的继续操作经公开 resume 命令归约", async () => {
    mocks.runEnvironmentCheck.mockResolvedValue(readyEnvironment);
    const completed = createRuntimeResult("revision-runtime-resume");
    const running: PublishRuntimeResult = {
      ...completed,
      attempt: {
        ...completed.attempt,
        status: "running",
        receipts: completed.attempt.receipts.map((receipt) => ({
          ...receipt,
          status: "submitted",
        })),
        routes: completed.attempt.routes.map((route) => ({
          ...route,
          status: "submitted",
        })),
      },
    };
    mocks.startPublishRuntime.mockResolvedValueOnce(running);
    mocks.resumePublishRuntime.mockResolvedValueOnce(completed);
    const props = createRunnerProps();
    const { result } = renderHook(() => usePublishRunner(props));

    await act(async () => {
      await result.current.runPublishSpec(
        {
          version: 1,
          provider_id: "dotnet",
          project_path: "/repo/App.csproj",
          parameters: { configuration: "Release" },
        },
        { repoId: "repo-1" },
        createPreparedRuntime("revision-runtime-resume")
      );
    });
    await act(async () => {
      await result.current.startPublish();
    });

    expect(mocks.resumePublishRuntime).toHaveBeenCalledWith({
      attemptId: running.attempt.attemptId,
    });
    expect(result.current.runtimeResult?.attempt.status).toBe("published");
  });

  it("控制面重启后按仓库与配置版本恢复最新 Running Attempt", async () => {
    const completed = createRuntimeResult("revision-runtime-restart");
    const running: PublishRuntimeResult = {
      ...completed,
      attempt: {
        ...completed.attempt,
        status: "running",
      },
    };
    mocks.synchronizePublishRuntime.mockResolvedValueOnce({
      attemptId: running.attempt.attemptId,
      acceptedEvents: 0,
      duplicateEvents: 0,
      missingRanges: [],
      result: running,
    });
    const props = createRunnerProps();
    props.configurationRevisionId = "revision-runtime-restart";
    const { result } = renderHook(() => usePublishRunner(props));

    await waitFor(() => {
      expect(result.current.runtimeResult?.attempt.attemptId).toBe(
        running.attempt.attemptId
      );
    });
    expect(mocks.synchronizePublishRuntime).toHaveBeenCalledWith({
      repositoryPath: "/repo",
      configurationRevisionId: "revision-runtime-restart",
      events: [],
    });
    expect(usePublishStore.getState().isPublishing).toBe(false);
  });

  it("启动跨过 Header 后状态不确定时，从 Journal 恢复 Attempt 而不伪造失败", async () => {
    mocks.runEnvironmentCheck.mockResolvedValue(readyEnvironment);
    const completed = createRuntimeResult("revision-runtime-uncertain");
    const running: PublishRuntimeResult = {
      ...completed,
      attempt: {
        ...completed.attempt,
        status: "running",
      },
      publishResult: null,
    };
    mocks.startPublishRuntime.mockRejectedValueOnce({
      code: "publish_runtime_attempt_uncertain",
      message: "publish attempt requires recovery",
      details: running.attempt.attemptId,
    });
    mocks.synchronizePublishRuntime
      .mockResolvedValueOnce({
        attemptId: "attempt-none",
        acceptedEvents: 0,
        duplicateEvents: 0,
        missingRanges: [],
        result: null,
      })
      .mockResolvedValueOnce({
        attemptId: running.attempt.attemptId,
        acceptedEvents: 0,
        duplicateEvents: 0,
        missingRanges: [],
        result: running,
      });
    const props = createRunnerProps();
    props.configurationRevisionId = "revision-runtime-uncertain";
    const { result } = renderHook(() => usePublishRunner(props));
    await waitFor(() => {
      expect(mocks.synchronizePublishRuntime).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await result.current.runPublishSpec(
        {
          version: 1,
          provider_id: "dotnet",
          project_path: "/repo/App.csproj",
          parameters: { configuration: "Release" },
        },
        { repoId: "repo-1" },
        createPreparedRuntime("revision-runtime-uncertain")
      );
    });

    expect(result.current.runtimeResult?.attempt.attemptId).toBe(
      running.attempt.attemptId
    );
    expect(mocks.synchronizePublishRuntime).toHaveBeenLastCalledWith({
      repositoryPath: "/repo",
      configurationRevisionId: "revision-runtime-uncertain",
      attemptId: running.attempt.attemptId,
      events: [],
    });
    expect(usePublishStore.getState().publishResult).toBeNull();
    expect(usePublishStore.getState().currentPublishRecordId).toBeNull();
  });

  it("Runtime 启动请求被拒绝后不会保留活动 Attempt 绑定", async () => {
    mocks.runEnvironmentCheck.mockResolvedValue(readyEnvironment);
    mocks.startPublishRuntime.mockRejectedValueOnce(
      new Error("runtime request rejected")
    );
    const props = createRunnerProps();
    const { result } = renderHook(() => usePublishRunner(props));

    await act(async () => {
      await result.current.runPublishSpec(
        {
          version: 1,
          provider_id: "dotnet",
          project_path: "/repo/App.csproj",
          parameters: { configuration: "Release" },
        },
        { repoId: "repo-1" },
        createPreparedRuntime("revision-rejected")
      );
    });

    expect(result.current.activeRuntime).toBeNull();
    expect(result.current.runtimeResult).toBeNull();
    expect(usePublishStore.getState().publishResult).toEqual(
      expect.objectContaining({
        success: false,
        error: "runtime request rejected",
      })
    );
  });
});
