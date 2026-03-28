import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EnvironmentCheckResult } from "@/lib/environment";
import type { PublishConfigStore } from "@/lib/store";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => false),
  listen: vi.fn(),
  runEnvironmentCheck: vi.fn(),
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
  },
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
}));

vi.mock("@/hooks/useDotnetPublishSelection", () => ({
  useDotnetPublishSelection: mocks.useDotnetPublishSelection,
}));

vi.mock("@/hooks/usePublishSpecBuilder", () => ({
  usePublishSpecBuilder: mocks.usePublishSpecBuilder,
}));

vi.mock("@/lib/tauri/invokeErrors", () => ({
  extractInvokeErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
  extractInvokeErrorCode: () => "publish_cancel_failed",
  analyzePublishExecutionFailure: () => "process_failed",
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
  properties: {},
  define: [],
  useProfile: false,
  profileName: "",
};

function createRunnerProps() {
  return {
    appT: {
      environmentBlocked: "环境阻断",
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
    },
    presets: [],
    specVersion: 1,
    pushRecentConfig: vi.fn(),
    openEnvironmentDialog: vi.fn(),
    setEnvironmentLastResult: vi.fn(),
    savePublishRecord: vi.fn(),
  };
}

describe("usePublishRunner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      dotnetPublishPreviewCommand: 'dotnet publish "/repo/App.csproj"',
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
    mocks.invoke.mockResolvedValue({
      provider_id: "dotnet",
      success: true,
      cancelled: false,
      error: null,
      output_dir: "/exports/App/Release",
      file_count: 3,
    });

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

    expect(props.pushRecentConfig).toHaveBeenCalledWith("pubxml:FolderProfile");
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
    mocks.invoke.mockResolvedValue({
      provider_id: "dotnet",
      success: true,
      cancelled: false,
      error: null,
      output_dir: "/exports/App/Release",
      file_count: 0,
    });

    const props = createRunnerProps();
    const { result } = renderHook(() => usePublishRunner(props));

    await act(async () => {
      await result.current.startPublish();
    });

    expect(props.openEnvironmentDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        is_ready: false,
      }),
      ["dotnet"]
    );
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(props.savePublishRecord).not.toHaveBeenCalled();
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
      dotnetPublishPreviewCommand: 'dotnet publish "/repo/App.csproj"',
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
});
