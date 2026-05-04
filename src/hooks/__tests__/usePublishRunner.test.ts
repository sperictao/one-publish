import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EnvironmentCheckResult } from "@/lib/environment";
import type { PublishConfigStore } from "@/lib/store";

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

vi.mock("@/lib/environment", () => ({
  runEnvironmentCheck: mocks.runEnvironmentCheck,
  createEnvironmentCheckSnapshot: (
    result: EnvironmentCheckResult,
    providerIds?: string[]
  ) => ({
    providerIds: providerIds ?? [],
    result,
  }),
}));

vi.mock("@/hooks/useDotnetPublishSelection", () => ({
  useDotnetPublishSelection: mocks.useDotnetPublishSelection,
}));

vi.mock("@/hooks/usePublishSpecBuilder", () => ({
  usePublishSpecBuilder: mocks.usePublishSpecBuilder,
}));

vi.mock("@/lib/publishOutputPreflight", () => ({
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

vi.mock("@/lib/renderPublishCommand", () => ({
  renderPublishCommand: mocks.renderPublishCommand,
}));

vi.mock("@/lib/publishRuntime", () => ({
  executeProviderPublish: (spec: unknown) =>
    mocks.invoke("execute_provider_publish", { spec }),
  cancelProviderPublish: () => mocks.invoke("cancel_provider_publish"),
  renderProviderPublish: mocks.renderPublishCommand,
  preflightProviderPublishOutput: mocks.preflightPublishOutput,
}));

vi.mock("@/lib/store", async () => {
  const actual = await vi.importActual<typeof import("@/lib/store")>("@/lib/store");
  return {
    ...actual,
    openOutputDirectory: mocks.openOutputDirectory,
    setTrayPublishStatus: mocks.setTrayPublishStatus,
    showMainWindow: mocks.showMainWindow,
  };
});

vi.mock("@/lib/tauri/invokeErrors", () => ({
  extractInvokeErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
  extractInvokeErrorCode: () => "publish_cancel_failed",
  analyzePublishExecutionFailure: mocks.analyzePublishExecutionFailure,
}));

vi.mock("@/hooks/usePublishFailureFeedback", () => ({
  getPublishFailureFeedback: () => ({
    title: "发布失败",
    description: "boom",
  }),
}));

import { usePublishRunner } from "@/hooks/usePublishRunner";

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
  define: [],
  useProfile: false,
  profileName: "",
};

function createRenderedCommand(
  displayCommand = 'dotnet publish "/repo/App.csproj"'
) {
  return {
    program: "dotnet",
    args: ["publish", "/repo/App.csproj"],
    working_dir: "/repo",
    display_command: displayCommand,
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
    ...overrides,
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
    buildPublishSpecMock = vi.fn(() => ({
      version: 1,
      provider_id: "dotnet",
      project_path: "/repo/App.csproj",
      parameters: {
        configuration: "Debug",
      },
    }));

    mocks.useDotnetPublishSelection.mockReturnValue({
      getCurrentConfig: vi.fn(),
      recentConfigKeyForCurrentSelection: "pubxml:FolderProfile",
      resolvedProjectProfile: {
        profileName: "FolderProfile",
        filePath: "/repo/Properties/PublishProfiles/FolderProfile.pubxml",
        parsedProfile: {
          rootTagName: "Project",
          rawXml: "<Project />",
          sections: [],
        },
        parameters: {
          configuration: "Release",
          output: "/exports/App/Release",
        },
        editableConfig: defaultCustomConfig,
      },
      resolveSelectedProjectProfile: vi.fn(),
    });

    mocks.usePublishSpecBuilder.mockReturnValue({
      buildPublishSpec: buildPublishSpecMock,
    });
  });

  it("选中 pubxml 时直接使用解析后的参数执行发布", async () => {
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
            configuration: "Release",
            output: "/exports/App/Release",
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
            configuration: "Release",
            output: "/exports/App/Release",
          },
        }),
      })
    );
    expect(buildPublishSpecMock).not.toHaveBeenCalled();
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
          configuration: "Release",
          output: "/exports/App/Release",
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
          configuration: "Release",
          output: "/exports/App/Release",
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

    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.requestProtectedOutputAccess).toHaveBeenCalledWith(
      {
        version: 1,
        provider_id: "dotnet",
        project_path: "/repo/App.csproj",
        parameters: {
          configuration: "Release",
          output: "/exports/App/Release",
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
            "$ dotnet publish \"/repo/App.csproj\"",
            "/repo/App.csproj(79,3): error MSB3021: Unable to copy file \"/Users/test/.nuget/packages/hip.core/2.7.2.1/lib/net8.0/HiP.Core.xml\" to \"/Users/test/Downloads/publish/App/Debug/../HiP.Core.xml\".",
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

    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.requestProtectedOutputAccess).toHaveBeenCalledWith(
      {
        version: 1,
        provider_id: "dotnet",
        project_path: "/repo/App.csproj",
        parameters: {
          configuration: "Release",
          output: "/exports/App/Release",
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
      recentConfigKeyForCurrentSelection: "preset:release-fd",
      resolvedProjectProfile: null,
      resolveSelectedProjectProfile: vi.fn(),
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

    expect(props.pushRecentConfig).toHaveBeenCalledWith("userprofile:beta", "repo-2");
    expect(mocks.openOutputDirectory).toHaveBeenCalledWith("/exports/App/Release");
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
        output_log: '$ dotnet publish "/repo/App.csproj"\n[stderr] publish failed\n',
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
        output_log: '$ dotnet publish "/repo/App.csproj"\n[stderr] publish failed\n',
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
      expect(result.current.publishResult).toEqual(
        expect.objectContaining({
          success: true,
          output_dir: "/exports/App/Release",
        })
      );
      expect(result.current.lastPublishSpec).toEqual(
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
      expect(result.current.publishResult).toBeNull();
      expect(result.current.lastPublishSpec).toBeNull();
      expect(result.current.currentPublishRecordId).toBeNull();
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
      recentConfigKeyForCurrentSelection: null,
      resolvedProjectProfile: null,
      resolveSelectedProjectProfile: vi.fn(),
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
      expect(result.current.publishResult).toEqual(
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
      expect(result.current.publishResult).toEqual(
        expect.objectContaining({
          success: true,
          output_dir: "/exports/App/Release",
        })
      );
      expect(result.current.lastPublishSpec).toEqual(
        expect.objectContaining({
          project_path: "/repo/App.csproj",
        })
      );
      expect(result.current.outputLog).toContain("Build succeeded.");
    });
  });
});
