import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Repository } from "@/lib/store/types";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => true),
  listen: vi.fn(),
  getRepository: vi.fn(),
  getProfiles: vi.fn(),
  setTrayPublishStatus: vi.fn(),
  showMainWindow: vi.fn(),
  showSystemNotification: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  isTauri: mocks.isTauri,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.listen,
}));

vi.mock("@/lib/store/api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/store/api")>("@/lib/store/api");
  return {
    ...actual,
    getRepository: mocks.getRepository,
    getProfiles: mocks.getProfiles,
    setTrayPublishStatus: mocks.setTrayPublishStatus,
    showMainWindow: mocks.showMainWindow,
  };
});

vi.mock("@/lib/systemNotification", () => ({
  showSystemNotification: mocks.showSystemNotification,
}));

import {
  useTrayRecentPublish,
  resolveTrayPublishRequest,
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
      profiles: [],
      bindings: [],
      appliedBundles: [],
      drafts: [],
    },
    ...overrides,
  };
}

describe("useTrayRecentPublish", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listen.mockResolvedValue(() => {});
    mocks.getRepository.mockResolvedValue(createRepository());
    mocks.setTrayPublishStatus.mockResolvedValue(true);
    mocks.showSystemNotification.mockResolvedValue(true);
    mocks.showMainWindow.mockResolvedValue(true);
  });

  it("userprofile 解析为携带修订身份的 revision 来源，项目解析交给后端", async () => {
    const projectFile = "/repo/apps/second/src-tauri/tauri.conf.json";
    mocks.getRepository.mockResolvedValue(
      createRepository({ providerId: "tauri", projectFile })
    );
    mocks.getProfiles.mockResolvedValue([
      {
        id: "tauri-profile",
        revisionId: "r1",
        providerId: "tauri",
        parameters: {},
      },
    ]);
    const request = await resolveTrayPublishRequest({
      payload: { repoId: "repo-1", configKey: "userprofile:tauri-profile" },
    });
    expect(request.source).toEqual({
      kind: "revision",
      configurationId: "tauri-profile",
      revisionId: "r1",
    });
    expect(mocks.getProfiles).toHaveBeenCalledWith("repo-1");
  });

  it("支持从托盘直接执行 userprofile", async () => {
    const runPublishSpec = vi.fn().mockResolvedValue(undefined);
    let handler:
      | ((event: { payload: TrayPublishRequestPayload }) => Promise<void>)
      | null = null;
    mocks.listen.mockImplementation(async (_eventName, callback) => {
      handler = callback;
      return () => {};
    });
    mocks.getProfiles.mockResolvedValue([
      {
        id: "profile-42",
        revisionId: "revision-7",
        name: "Renamed",
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
        runPublishSpec,
      })
    );

    await waitFor(() => {
      expect(handler).not.toBeNull();
    });
    if (!handler) {
      throw new Error("tray handler missing");
    }
    const trayHandler = handler as (event: {
      payload: TrayPublishRequestPayload;
    }) => Promise<void>;

    await trayHandler({
      payload: {
        repoId: "repo-1",
        configKey: "userprofile:profile-42",
      },
    });

    expect(runPublishSpec).toHaveBeenCalledWith(
      {
        kind: "revision",
        configurationId: "profile-42",
        revisionId: "revision-7",
      },
      expect.objectContaining({
        repoId: "repo-1",
        recentConfigKey: "userprofile:profile-42",
        openOutputDirOnSuccess: true,
        restoreWindowOnFailure: false,
        feedbackMode: "system",
        trayStatusEffect: true,
      })
    );
  });

  it("userprofile 缺修订身份时明确失败，不执行默认草稿", async () => {
    const runPublishSpec = vi.fn().mockResolvedValue(undefined);
    let handler:
      | ((event: { payload: TrayPublishRequestPayload }) => Promise<void>)
      | null = null;
    mocks.listen.mockImplementation(async (_eventName, callback) => {
      handler = callback;
      return () => {};
    });
    mocks.getProfiles.mockResolvedValue([
      {
        id: "alpha",
        revisionId: "",
        name: "alpha",
        providerId: "dotnet",
        parameters: {
          configuration: "Debug",
          runtime: "osx-arm64",
        },
      },
    ]);

    renderHook(() =>
      useTrayRecentPublish({
        appT: {},
        runPublishSpec,
      })
    );

    await waitFor(() => {
      expect(handler).not.toBeNull();
    });
    if (!handler) {
      throw new Error("tray handler missing");
    }
    const trayHandler = handler as (event: {
      payload: TrayPublishRequestPayload;
    }) => Promise<void>;

    await trayHandler({
      payload: {
        repoId: "repo-1",
        configKey: "userprofile:alpha",
      },
    });

    expect(runPublishSpec).not.toHaveBeenCalled();
    expect(mocks.setTrayPublishStatus).toHaveBeenCalledWith("failure");
    expect(mocks.showSystemNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "missing configuration revision: alpha",
      })
    );
  });

  it("支持从托盘直接执行 pubxml", async () => {
    const runPublishSpec = vi.fn().mockResolvedValue(undefined);
    let handler:
      | ((event: { payload: TrayPublishRequestPayload }) => Promise<void>)
      | null = null;
    mocks.listen.mockImplementation(async (_eventName, callback) => {
      handler = callback;
      return () => {};
    });
    renderHook(() =>
      useTrayRecentPublish({
        appT: {},
        runPublishSpec,
      })
    );

    await waitFor(() => {
      expect(handler).not.toBeNull();
    });

    if (!handler) {
      throw new Error("tray handler missing");
    }
    const trayHandler = handler as (event: {
      payload: TrayPublishRequestPayload;
    }) => Promise<void>;

    await trayHandler({
      payload: {
        repoId: "repo-1",
        configKey: "pubxml:FolderProfile",
      },
    });

    expect(runPublishSpec).toHaveBeenCalledWith(
      {
        kind: "projectProfile",
        providerId: "dotnet",
        reference: "FolderProfile",
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
    let handler:
      | ((event: { payload: TrayPublishRequestPayload }) => Promise<void>)
      | null = null;
    mocks.listen.mockImplementation(async (_eventName, callback) => {
      handler = callback;
      return () => {};
    });
    mocks.getProfiles.mockResolvedValue([
      {
        id: "alpha",
        revisionId: "alpha-revision",
        name: "alpha",
        providerId: "dotnet",
        parameters: {
          configuration: "Release",
        },
      },
    ]);

    renderHook(() =>
      useTrayRecentPublish({
        appT: {},
        runPublishSpec,
      })
    );

    await waitFor(() => {
      expect(handler).not.toBeNull();
    });

    if (!handler) {
      throw new Error("tray handler missing");
    }
    const trayHandler = handler as (event: {
      payload: TrayPublishRequestPayload;
    }) => Promise<void>;

    await trayHandler({
      payload: {
        repoId: "repo-1",
        configKey: "userprofile:alpha",
      },
    });

    expect(mocks.getRepository).toHaveBeenCalledWith("repo-1");
    expect(runPublishSpec).toHaveBeenCalledWith(
      {
        kind: "revision",
        configurationId: "alpha",
        revisionId: "alpha-revision",
      },
      expect.objectContaining({
        repoId: "repo-1",
        recentConfigKey: "userprofile:alpha",
        trayStatusEffect: true,
      })
    );
  });

  it("后端仓库快照缺失时会反馈原始错误", async () => {
    const runPublishSpec = vi.fn().mockResolvedValue(undefined);
    let handler:
      | ((event: { payload: TrayPublishRequestPayload }) => Promise<void>)
      | null = null;
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
        runPublishSpec,
      })
    );

    await waitFor(() => {
      expect(handler).not.toBeNull();
    });

    if (!handler) {
      throw new Error("tray handler missing");
    }
    const trayHandler = handler as (event: {
      payload: TrayPublishRequestPayload;
    }) => Promise<void>;

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
    let handler:
      | ((event: { payload: TrayPublishRequestPayload }) => Promise<void>)
      | null = null;
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
        runPublishSpec,
      })
    );

    await waitFor(() => {
      expect(handler).not.toBeNull();
    });

    if (!handler) {
      throw new Error("tray handler missing");
    }
    const trayHandler = handler as (event: {
      payload: TrayPublishRequestPayload;
    }) => Promise<void>;

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

  it("Provider 版本不兼容的配置不会从托盘绕过阻断执行", async () => {
    const runPublishSpec = vi.fn().mockResolvedValue(undefined);
    let handler:
      | ((event: { payload: TrayPublishRequestPayload }) => Promise<void>)
      | null = null;
    mocks.listen.mockImplementation(async (_eventName, callback) => {
      handler = callback;
      return () => {};
    });
    mocks.getProfiles.mockResolvedValue([
      {
        id: "blocked-profile",
        revisionId: "blocked-revision",
        name: "Future Cargo",
        providerId: "cargo",
        parameters: { release: true },
        blockedReason: "provider_version_unsupported:7",
      },
    ]);

    renderHook(() =>
      useTrayRecentPublish({
        appT: {
          trayPublishFailed: "状态栏发布启动失败",
        },
        runPublishSpec,
      })
    );

    await waitFor(() => {
      expect(handler).not.toBeNull();
    });
    if (!handler) {
      throw new Error("tray handler missing");
    }

    const trayHandler = handler as (event: {
      payload: TrayPublishRequestPayload;
    }) => Promise<void>;
    await trayHandler({
      payload: {
        repoId: "repo-1",
        configKey: "userprofile:blocked-profile",
      },
    });

    expect(runPublishSpec).not.toHaveBeenCalled();
    expect(mocks.setTrayPublishStatus).toHaveBeenCalledWith("failure");
    expect(mocks.showSystemNotification).toHaveBeenCalledWith({
      title: "状态栏发布启动失败",
      body: "配置不可执行：provider_version_unsupported:7",
    });
  });

  it("如果系统通知发送失败会回退显示主窗口", async () => {
    const runPublishSpec = vi.fn().mockResolvedValue(undefined);
    let handler:
      | ((event: { payload: TrayPublishRequestPayload }) => Promise<void>)
      | null = null;
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
        runPublishSpec,
      })
    );

    await waitFor(() => {
      expect(handler).not.toBeNull();
    });

    if (!handler) {
      throw new Error("tray handler missing");
    }

    const trayHandler = handler as (event: {
      payload: TrayPublishRequestPayload;
    }) => Promise<void>;

    await trayHandler({
      payload: {
        repoId: "repo-1",
        configKey: "userprofile:missing",
      },
    });

    expect(mocks.showMainWindow).toHaveBeenCalled();
  });
});
