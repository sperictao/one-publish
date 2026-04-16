import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Repository } from "@/types/repository";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => true),
  listen: vi.fn(),
  getRepository: vi.fn(),
  getProfiles: vi.fn(),
  resolveProjectInfo: vi.fn(),
  scanProject: vi.fn(),
  setTrayPublishStatus: vi.fn(),
  showMainWindow: vi.fn(),
  showSystemNotification: vi.fn(),
  resolveDotnetProjectProfile: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  isTauri: mocks.isTauri,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.listen,
}));

vi.mock("@/lib/store", async () => {
  const actual = await vi.importActual<typeof import("@/lib/store")>("@/lib/store");
  return {
    ...actual,
    getRepository: mocks.getRepository,
    getProfiles: mocks.getProfiles,
    resolveProjectInfo: mocks.resolveProjectInfo,
    scanProject: mocks.scanProject,
    setTrayPublishStatus: mocks.setTrayPublishStatus,
    showMainWindow: mocks.showMainWindow,
  };
});

vi.mock("@/lib/dotnetProjectProfile", () => ({
  resolveDotnetProjectProfile: mocks.resolveDotnetProjectProfile,
}));

vi.mock("@/lib/systemNotification", () => ({
  showSystemNotification: mocks.showSystemNotification,
}));

import {
  useTrayRecentPublish,
  type TrayPublishRequestPayload,
} from "@/hooks/useTrayRecentPublish";

function createRepository(overrides?: Partial<Repository>): Repository {
  return {
    id: "repo-1",
    name: "Repo 1",
    path: "/repo",
    projectFile: "/repo/App.csproj",
    currentBranch: "main",
    branches: [],
    isMain: true,
    providerId: "dotnet",
    publishConfig: {
      selectedPreset: "release-fd",
      isCustomMode: false,
      customConfig: {
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
      },
      profiles: [],
    },
    ...overrides,
  };
}

describe("useTrayRecentPublish", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listen.mockResolvedValue(() => {});
    mocks.getRepository.mockResolvedValue(createRepository());
    mocks.resolveProjectInfo.mockResolvedValue({
      root_path: "/repo",
      project_file: "/repo/App.csproj",
      publish_profiles: ["FolderProfile"],
      target_frameworks: ["net8.0"],
    });
    mocks.scanProject.mockResolvedValue({
      root_path: "/repo",
      project_file: "/repo/App.csproj",
      publish_profiles: ["FolderProfile"],
      target_frameworks: ["net8.0"],
    });
    mocks.setTrayPublishStatus.mockResolvedValue(true);
    mocks.showSystemNotification.mockResolvedValue(true);
    mocks.showMainWindow.mockResolvedValue(true);
  });

  it("支持从托盘直接执行 userprofile", async () => {
    const runPublishSpec = vi.fn().mockResolvedValue(undefined);
    let handler: ((event: { payload: TrayPublishRequestPayload }) => Promise<void>) | null =
      null;
    mocks.listen.mockImplementation(async (_eventName, callback) => {
      handler = callback;
      return () => {};
    });
    mocks.getProfiles.mockResolvedValue([
      {
        name: "alpha",
        providerId: "dotnet",
        parameters: {
          configuration: "Release",
          output: "/repo/out",
        },
      },
    ]);

    renderHook(() =>
      useTrayRecentPublish({
        appT: {},
        defaultOutputDir: "/exports",
        specVersion: 1,
        runPublishSpec,
      })
    );

    await waitFor(() => {
      expect(handler).not.toBeNull();
    });
    if (!handler) {
      throw new Error("tray handler missing");
    }
    const trayHandler = handler as (
      event: { payload: TrayPublishRequestPayload }
    ) => Promise<void>;

    await trayHandler({
      payload: {
        repoId: "repo-1",
        configKey: "userprofile:alpha",
      },
    });

    expect(runPublishSpec).toHaveBeenCalledWith(
      {
        version: 1,
        provider_id: "dotnet",
        project_path: "/repo/App.csproj",
        parameters: {
          configuration: "Release",
          output: "/repo/out",
        },
      },
      expect.objectContaining({
        repoId: "repo-1",
        recentConfigKey: "userprofile:alpha",
        openOutputDirOnSuccess: true,
        restoreWindowOnFailure: false,
        feedbackMode: "system",
        trayStatusEffect: true,
      })
    );
  });

  it("userprofile 里的空 output 会按默认输出目录规则标准化", async () => {
    const runPublishSpec = vi.fn().mockResolvedValue(undefined);
    let handler: ((event: { payload: TrayPublishRequestPayload }) => Promise<void>) | null =
      null;
    mocks.listen.mockImplementation(async (_eventName, callback) => {
      handler = callback;
      return () => {};
    });
    mocks.getProfiles.mockResolvedValue([
      {
        name: "alpha",
        providerId: "dotnet",
        parameters: {
          configuration: "Debug",
          output: "",
          runtime: "osx-arm64",
        },
      },
    ]);

    renderHook(() =>
      useTrayRecentPublish({
        appT: {},
        defaultOutputDir: "/exports",
        specVersion: 1,
        runPublishSpec,
      })
    );

    await waitFor(() => {
      expect(handler).not.toBeNull();
    });
    if (!handler) {
      throw new Error("tray handler missing");
    }
    const trayHandler = handler as (
      event: { payload: TrayPublishRequestPayload }
    ) => Promise<void>;

    await trayHandler({
      payload: {
        repoId: "repo-1",
        configKey: "userprofile:alpha",
      },
    });

    expect(runPublishSpec).toHaveBeenCalledWith(
      expect.objectContaining({
        parameters: {
          configuration: "Debug",
          output: "/exports/App/Debug",
          runtime: "osx-arm64",
        },
      }),
      expect.objectContaining({
        repoId: "repo-1",
        trayStatusEffect: true,
      })
    );
  });

  it("仓库 projectFile 是 .sln 时会回退扫描真实项目文件", async () => {
    const runPublishSpec = vi.fn().mockResolvedValue(undefined);
    let handler: ((event: { payload: TrayPublishRequestPayload }) => Promise<void>) | null =
      null;
    mocks.listen.mockImplementation(async (_eventName, callback) => {
      handler = callback;
      return () => {};
    });
    mocks.getProfiles.mockResolvedValue([
      {
        name: "alpha",
        providerId: "dotnet",
        parameters: {
          configuration: "Release",
        },
      },
    ]);
    mocks.getRepository.mockResolvedValue(
      createRepository({
        projectFile: "/repo/App.sln",
      })
    );
    mocks.scanProject.mockResolvedValue({
      root_path: "/repo",
      project_file: "/repo/UI/App.csproj",
      publish_profiles: ["FolderProfile"],
      target_frameworks: ["net8.0"],
    });

    renderHook(() =>
      useTrayRecentPublish({
        appT: {},
        defaultOutputDir: "/exports",
        specVersion: 1,
        runPublishSpec,
      })
    );

    await waitFor(() => {
      expect(handler).not.toBeNull();
    });
    if (!handler) {
      throw new Error("tray handler missing");
    }
    const trayHandler = handler as (
      event: { payload: TrayPublishRequestPayload }
    ) => Promise<void>;

    await trayHandler({
      payload: {
        repoId: "repo-1",
        configKey: "userprofile:alpha",
      },
    });

    expect(mocks.scanProject).toHaveBeenCalledWith("/repo");
    expect(runPublishSpec).toHaveBeenCalledWith(
      expect.objectContaining({
        project_path: "/repo/UI/App.csproj",
      }),
      expect.objectContaining({
        repoId: "repo-1",
        recentConfigKey: "userprofile:alpha",
        trayStatusEffect: true,
      })
    );
  });

  it("支持从托盘直接执行 pubxml", async () => {
    const runPublishSpec = vi.fn().mockResolvedValue(undefined);
    let handler: ((event: { payload: TrayPublishRequestPayload }) => Promise<void>) | null =
      null;
    mocks.listen.mockImplementation(async (_eventName, callback) => {
      handler = callback;
      return () => {};
    });
    mocks.resolveDotnetProjectProfile.mockResolvedValue({
      profileName: "FolderProfile",
      filePath: "/repo/Properties/PublishProfiles/FolderProfile.pubxml",
      parsedProfile: {
        rootTagName: "Project",
        rawXml: "<Project />",
        sections: [],
      },
      parameters: {
        configuration: "Release",
        output: "/exports/Repo/Release",
      },
      editableConfig: null,
    });

    renderHook(() =>
      useTrayRecentPublish({
        appT: {},
        defaultOutputDir: "/exports",
        specVersion: 1,
        runPublishSpec,
      })
    );

    await waitFor(() => {
      expect(handler).not.toBeNull();
    });

    if (!handler) {
      throw new Error("tray handler missing");
    }
    const trayHandler = handler as (
      event: { payload: TrayPublishRequestPayload }
    ) => Promise<void>;

    await trayHandler({
      payload: {
        repoId: "repo-1",
        configKey: "pubxml:FolderProfile",
      },
    });

    expect(runPublishSpec).toHaveBeenCalledWith(
      {
        version: 1,
        provider_id: "dotnet",
        project_path: "/repo/App.csproj",
        parameters: {
          configuration: "Release",
          output: "/exports/Repo/Release",
        },
      },
      expect.objectContaining({
        repoId: "repo-1",
        recentConfigKey: "pubxml:FolderProfile",
        trayStatusEffect: true,
      })
    );
  });

  it("托盘发布始终从后端仓库快照解析仓库", async () => {
    const runPublishSpec = vi.fn().mockResolvedValue(undefined);
    let handler: ((event: { payload: TrayPublishRequestPayload }) => Promise<void>) | null =
      null;
    mocks.listen.mockImplementation(async (_eventName, callback) => {
      handler = callback;
      return () => {};
    });
    mocks.getProfiles.mockResolvedValue([
      {
        name: "alpha",
        providerId: "dotnet",
        parameters: {
          configuration: "Release",
          output: "/repo/out",
        },
      },
    ]);

    renderHook(() =>
      useTrayRecentPublish({
        appT: {},
        defaultOutputDir: "/exports",
        specVersion: 1,
        runPublishSpec,
      })
    );

    await waitFor(() => {
      expect(handler).not.toBeNull();
    });

    if (!handler) {
      throw new Error("tray handler missing");
    }
    const trayHandler = handler as (
      event: { payload: TrayPublishRequestPayload }
    ) => Promise<void>;

    await trayHandler({
      payload: {
        repoId: "repo-1",
        configKey: "userprofile:alpha",
      },
    });

    expect(mocks.getRepository).toHaveBeenCalledWith("repo-1");
    expect(mocks.resolveProjectInfo).toHaveBeenCalledWith("/repo/App.csproj");
    expect(runPublishSpec).toHaveBeenCalledWith(
      expect.objectContaining({
        project_path: "/repo/App.csproj",
      }),
      expect.objectContaining({
        repoId: "repo-1",
        recentConfigKey: "userprofile:alpha",
        trayStatusEffect: true,
      })
    );
  });

  it("后端仓库快照缺失时会反馈原始错误", async () => {
    const runPublishSpec = vi.fn().mockResolvedValue(undefined);
    let handler: ((event: { payload: TrayPublishRequestPayload }) => Promise<void>) | null =
      null;
    mocks.listen.mockImplementation(async (_eventName, callback) => {
      handler = callback;
      return () => {};
    });
    mocks.getRepository.mockRejectedValue(new Error("未找到仓库: repo-404"));

    renderHook(() =>
      useTrayRecentPublish({
        appT: {
          trayPublishFailed: "状态栏发布启动失败",
        },
        defaultOutputDir: "/exports",
        specVersion: 1,
        runPublishSpec,
      })
    );

    await waitFor(() => {
      expect(handler).not.toBeNull();
    });

    if (!handler) {
      throw new Error("tray handler missing");
    }
    const trayHandler = handler as (
      event: { payload: TrayPublishRequestPayload }
    ) => Promise<void>;

    await trayHandler({
      payload: {
        repoId: "repo-404",
        configKey: "userprofile:alpha",
      },
    });

    expect(runPublishSpec).not.toHaveBeenCalled();
    expect(mocks.setTrayPublishStatus).toHaveBeenCalledWith("failure");
    expect(mocks.showSystemNotification).toHaveBeenCalledWith({
      title: "状态栏发布启动失败",
      body: "未找到仓库: repo-404",
    });
  });

  it("遇到失效配置时不会执行发布并拉起主窗口", async () => {
    const runPublishSpec = vi.fn().mockResolvedValue(undefined);
    let handler: ((event: { payload: TrayPublishRequestPayload }) => Promise<void>) | null =
      null;
    mocks.listen.mockImplementation(async (_eventName, callback) => {
      handler = callback;
      return () => {};
    });
    mocks.getProfiles.mockResolvedValue([]);

    renderHook(() =>
      useTrayRecentPublish({
        appT: {
          trayPublishFailed: "状态栏发布启动失败",
        },
        defaultOutputDir: "/exports",
        specVersion: 1,
        runPublishSpec,
      })
    );

    await waitFor(() => {
      expect(handler).not.toBeNull();
    });

    if (!handler) {
      throw new Error("tray handler missing");
    }
    const trayHandler = handler as (
      event: { payload: TrayPublishRequestPayload }
    ) => Promise<void>;

    await trayHandler({
      payload: {
        repoId: "repo-1",
        configKey: "userprofile:missing",
      },
    });

    expect(runPublishSpec).not.toHaveBeenCalled();
    expect(mocks.setTrayPublishStatus).toHaveBeenCalledWith("failure");
    expect(mocks.showSystemNotification).toHaveBeenCalledWith({
      title: "状态栏发布启动失败",
      body: "missing user profile: missing",
    });
    expect(mocks.showMainWindow).not.toHaveBeenCalled();
  });

  it("未绑定且存在多个候选项目时不会触发托盘发布", async () => {
    const runPublishSpec = vi.fn().mockResolvedValue(undefined);
    let handler: ((event: { payload: TrayPublishRequestPayload }) => Promise<void>) | null =
      null;
    mocks.listen.mockImplementation(async (_eventName, callback) => {
      handler = callback;
      return () => {};
    });
    mocks.getRepository.mockResolvedValue(
      createRepository({
        projectFile: undefined,
      })
    );
    mocks.getProfiles.mockResolvedValue([
      {
        name: "alpha",
        providerId: "dotnet",
        parameters: {
          configuration: "Release",
        },
      },
    ]);
    mocks.scanProject.mockRejectedValue({
      code: "multiple_project_files_found",
      message: "multiple project files found",
    });

    renderHook(() =>
      useTrayRecentPublish({
        appT: {
          trayPublishFailed: "状态栏发布启动失败",
        },
        defaultOutputDir: "/exports",
        specVersion: 1,
        runPublishSpec,
      })
    );

    await waitFor(() => {
      expect(handler).not.toBeNull();
    });

    if (!handler) {
      throw new Error("tray handler missing");
    }
    const trayHandler = handler as (
      event: { payload: TrayPublishRequestPayload }
    ) => Promise<void>;

    await trayHandler({
      payload: {
        repoId: "repo-1",
        configKey: "userprofile:alpha",
      },
    });

    expect(runPublishSpec).not.toHaveBeenCalled();
    expect(mocks.showSystemNotification).toHaveBeenCalledWith({
      title: "状态栏发布启动失败",
      body: "该仓库包含多个项目文件，请先在仓库设置中绑定明确的 Project File。",
    });
  });

  it("如果系统通知发送失败会回退显示主窗口", async () => {
    const runPublishSpec = vi.fn().mockResolvedValue(undefined);
    let handler: ((event: { payload: TrayPublishRequestPayload }) => Promise<void>) | null =
      null;
    mocks.listen.mockImplementation(async (_eventName, callback) => {
      handler = callback;
      return () => {};
    });
    mocks.getProfiles.mockResolvedValue([]);
    mocks.showSystemNotification.mockResolvedValue(false);

    renderHook(() =>
      useTrayRecentPublish({
        appT: {
          trayPublishFailed: "状态栏发布启动失败",
        },
        defaultOutputDir: "/exports",
        specVersion: 1,
        runPublishSpec,
      })
    );

    await waitFor(() => {
      expect(handler).not.toBeNull();
    });

    if (!handler) {
      throw new Error("tray handler missing");
    }

    const trayHandler = handler as (
      event: { payload: TrayPublishRequestPayload }
    ) => Promise<void>;

    await trayHandler({
      payload: {
        repoId: "repo-1",
        configKey: "userprofile:missing",
      },
    });

    expect(mocks.showMainWindow).toHaveBeenCalled();
  });
});
