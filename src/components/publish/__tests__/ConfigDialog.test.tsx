import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  openDialog: vi.fn(),
  saveDialog: vi.fn(),
  importConfig: vi.fn(),
  refreshProfiles: vi.fn(),
  saveProfile: vi.fn(),
  deleteProfile: vi.fn(),
  exportProfiles: vi.fn(),
  applyImportedProfiles: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: mocks.openDialog,
  save: mocks.saveDialog,
}));

vi.mock("sonner", () => ({
  toast: {
    success: mocks.toastSuccess,
    warning: mocks.toastWarning,
    error: mocks.toastError,
  },
}));

vi.mock("@/hooks/useI18n", () => ({
  useI18n: () => ({
    language: "zh",
    translations: {
      profiles: {},
      common: {
        cancel: "取消",
      },
    },
  }),
}));

vi.mock("@/lib/store/api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/store/api")>("@/lib/store/api");
  return {
    ...actual,
    importConfig: mocks.importConfig,
  };
});

import { ConfigManagementContent } from "@/components/publish/ConfigDialog";
import type { ConfigParameters, ConfigProfile } from "@/lib/store/types";

beforeAll(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation(() => ({
      matches: false,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  );

  if (typeof PointerEvent === "undefined") {
    vi.stubGlobal("PointerEvent", MouseEvent);
  }

  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );

  if (!HTMLElement.prototype.getAnimations) {
    Object.defineProperty(HTMLElement.prototype, "getAnimations", {
      value: () => [],
    });
  }

  if (!HTMLElement.prototype.animate) {
    Object.defineProperty(HTMLElement.prototype, "animate", {
      value: () => ({
        cancel() {},
      }),
    });
  }
});

describe("ConfigManagementContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.openDialog.mockResolvedValue("/tmp/one-publish-config.json");
    mocks.saveDialog.mockResolvedValue("/tmp/new-export.json");
    mocks.refreshProfiles.mockResolvedValue([]);
    mocks.saveProfile.mockResolvedValue(undefined);
    mocks.deleteProfile.mockResolvedValue(undefined);
    mocks.exportProfiles.mockImplementation(async (filePath: string) =>
      filePath.endsWith(".json") ? filePath : `${filePath}.json`
    );
    mocks.applyImportedProfiles.mockResolvedValue({
      imported: 2,
      skippedExisting: 0,
      skippedProviderMismatch: 0,
    });
  });

  function renderConfigManagementContent({
    profiles = [],
    currentParameters = {},
    repoId = "repo-1",
    repositoryProviderId = "dotnet",
    onLoadProfile = vi.fn(() => true),
    closeOnLoad = false,
    onClose,
  }: {
    profiles?: ConfigProfile[];
    currentParameters?: ConfigParameters;
    repoId?: string | null;
    repositoryProviderId?: string | null;
    onLoadProfile?: (profile: ConfigProfile) => boolean;
    closeOnLoad?: boolean;
    onClose?: () => void;
  } = {}) {
    return render(
      <ConfigManagementContent
        active
        profiles={profiles}
        isProfilesRefreshing={false}
        onRefreshProfiles={mocks.refreshProfiles}
        onSaveProfile={mocks.saveProfile}
        onDeleteProfile={mocks.deleteProfile}
        onExportProfiles={mocks.exportProfiles}
        onApplyImportedProfiles={mocks.applyImportedProfiles}
        onLoadProfile={onLoadProfile}
        currentProviderId="dotnet"
        repositoryProviderId={repositoryProviderId}
        repoId={repoId}
        currentParameters={currentParameters}
        closeOnLoad={closeOnLoad}
        onClose={onClose}
      />
    );
  }

  function savedProfile(name: string, providerId = "dotnet"): ConfigProfile {
    return {
      id: `profile-${name}`,
      revisionId: `revision-${name}`,
      name,
      providerId,
      parameters: {},
      profileGroup: null,
      createdAt: "2026-04-02T12:00:00.000Z",
      isSystemDefault: false,
      externalBindingIds: [],
    };
  }

  function importedProfile(name: string, providerId: string): ConfigProfile {
    return {
      id: "",
      revisionId: "",
      name,
      providerId,
      parameters: {},
      profileGroup: null,
      createdAt: "2026-04-02T12:00:00.000Z",
      isSystemDefault: false,
      externalBindingIds: [],
    };
  }

  async function openImportPreview(profiles: ConfigProfile[]) {
    mocks.importConfig.mockResolvedValue({
      version: 2,
      exportedAt: "2026-04-02T12:00:00.000Z",
      profiles,
    });
    fireEvent.click(screen.getByRole("button", { name: "导入配置" }));
    await screen.findByText("确认导入配置");
  }

  it("打开后通过 profile owner 刷新，并渲染 owner 提供的列表", async () => {
    renderConfigManagementContent({
      profiles: [
        {
          id: "profile-release",
          revisionId: "revision-release",
          name: "Release",
          providerId: "dotnet",
          parameters: {},
          profileGroup: null,
          createdAt: "2026-04-02T12:00:00.000Z",
          isSystemDefault: false,
          externalBindingIds: [],
        },
      ],
    });

    await waitFor(() => {
      expect(mocks.refreshProfiles).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText("Release")).toBeInTheDocument();
  });

  it("保存当前配置时只调用 profile owner mutation", async () => {
    renderConfigManagementContent({
      currentParameters: {
        configuration: "Release",
      },
    });

    fireEvent.change(screen.getByLabelText("输入配置文件名称"), {
      target: { value: "Release" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));

    await waitFor(() => {
      expect(mocks.saveProfile).toHaveBeenCalledWith({
        name: "Release",
        providerId: "dotnet",
        parameters: {
          configuration: "Release",
        },
      });
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("配置已保存");
  });

  it("导出配置时用保存对话框选择目标路径，以便创建新文件", async () => {
    renderConfigManagementContent();

    fireEvent.click(screen.getByRole("button", { name: "导出配置" }));

    await waitFor(() => {
      expect(mocks.exportProfiles).toHaveBeenCalledWith("/tmp/new-export.json");
    });
    expect(mocks.saveDialog).toHaveBeenCalledWith({
      filters: [{ name: "JSON", extensions: ["json"] }],
      defaultPath: "one-publish-config.json",
    });
    expect(mocks.openDialog).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).toHaveBeenCalledWith("配置已导出", {
      description: "/tmp/new-export.json",
    });
  });

  it("导出成功提示显示后端实际写入的路径（GTK 未补扩展名时由后端补齐）", async () => {
    mocks.saveDialog.mockResolvedValue("/tmp/backup");
    renderConfigManagementContent();

    fireEvent.click(screen.getByRole("button", { name: "导出配置" }));

    await waitFor(() => {
      expect(mocks.toastSuccess).toHaveBeenCalledWith("配置已导出", {
        description: "/tmp/backup.json",
      });
    });
    expect(mocks.exportProfiles).toHaveBeenCalledWith("/tmp/backup");
  });

  it("未选择仓库时禁用导出与导入，不弹出保存对话框", () => {
    renderConfigManagementContent({ repoId: null });

    const exportButton = screen.getByRole("button", { name: "导出配置" });
    const importButton = screen.getByRole("button", { name: "导入配置" });
    expect(exportButton).toBeDisabled();
    expect(importButton).toBeDisabled();

    fireEvent.click(exportButton);

    expect(mocks.saveDialog).not.toHaveBeenCalled();
    expect(mocks.exportProfiles).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("导入配置时先显示应用内确认对话框，再执行真正导入", async () => {
    const importedProfiles = [
      {
        name: "Release",
        providerId: "dotnet",
        parameters: {
          configuration: "Release",
        },
        profileGroup: null,
        createdAt: "2026-04-02T12:00:00.000Z",
        isSystemDefault: false,
      },
      {
        name: "Nightly",
        providerId: "cargo",
        parameters: {},
        profileGroup: "CI",
        createdAt: "2026-04-02T12:00:00.000Z",
        isSystemDefault: false,
      },
    ];
    mocks.importConfig.mockResolvedValue({
      version: 1,
      exportedAt: "2026-04-02T12:00:00.000Z",
      profiles: importedProfiles,
    });
    renderConfigManagementContent();

    fireEvent.click(screen.getByRole("button", { name: "导入配置" }));

    await waitFor(() => {
      expect(mocks.importConfig).toHaveBeenCalledWith(
        "/tmp/one-publish-config.json"
      );
    });

    expect(mocks.applyImportedProfiles).not.toHaveBeenCalled();
    expect(screen.getByText("确认导入配置")).toBeInTheDocument();
    expect(screen.getByText("待导入配置")).toBeInTheDocument();
    expect(screen.getByText("Release")).toBeInTheDocument();
    expect(screen.getByText("Nightly")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "导入配置" }));

    await waitFor(() => {
      expect(mocks.applyImportedProfiles).toHaveBeenCalledWith(
        importedProfiles
      );
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("配置已导入", {
      description: "已导入：2",
    });
  });

  it("确认文案如实说明同名跳过、不覆盖", async () => {
    renderConfigManagementContent();

    await openImportPreview([importedProfile("Release", "dotnet")]);

    expect(
      screen.getByText(
        "文件中共有 1 个配置。同名配置会被跳过，不会覆盖当前仓库已有的配置。"
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/合并或覆盖/)).not.toBeInTheDocument();
  });

  it("跨 Provider 导入：明确标出不会导入的配置，并展示后端返回的计数", async () => {
    mocks.applyImportedProfiles.mockResolvedValue({
      imported: 1,
      skippedExisting: 0,
      skippedProviderMismatch: 1,
    });
    renderConfigManagementContent({ repositoryProviderId: "cargo" });
    const profiles = [
      importedProfile("linux-amd64", "go"),
      importedProfile("release", "cargo"),
    ];

    await openImportPreview(profiles);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "1 个配置属于其他 Provider，与当前仓库的 Provider（cargo）不一致，不会导入。"
    );
    const goRow = screen.getByText("linux-amd64").closest("li");
    expect(goRow).toHaveTextContent("Provider 不一致，不导入");
    const cargoRow = screen.getByText("release").closest("li");
    expect(cargoRow).not.toHaveTextContent("不导入");

    const confirmButton = screen.getByRole("button", { name: "导入配置" });
    expect(confirmButton).toBeEnabled();
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(mocks.applyImportedProfiles).toHaveBeenCalledWith(profiles);
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("配置已导入", {
      description: "已导入：1 · Provider 不一致未导入：1",
    });
  });

  it("全部配置都属于其他 Provider 时禁止确认导入", async () => {
    renderConfigManagementContent({ repositoryProviderId: "cargo" });

    await openImportPreview([
      importedProfile("linux-amd64", "go"),
      importedProfile("darwin-arm64", "go"),
    ]);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "2 个配置属于其他 Provider"
    );
    expect(screen.getByText("没有可导入的配置。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导入配置" })).toBeDisabled();
  });

  it("仓库未声明 Provider 时不标记 Provider 不一致", async () => {
    renderConfigManagementContent({ repositoryProviderId: null });

    await openImportPreview([importedProfile("linux-amd64", "go")]);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导入配置" })).toBeEnabled();
  });

  it("同名配置标记为跳过，提示展示跳过计数", async () => {
    mocks.applyImportedProfiles.mockResolvedValue({
      imported: 1,
      skippedExisting: 1,
      skippedProviderMismatch: 0,
    });
    renderConfigManagementContent({ profiles: [savedProfile("Release")] });

    await openImportPreview([
      importedProfile("Release", "dotnet"),
      importedProfile("Nightly", "dotnet"),
    ]);

    const releaseRow = screen
      .getAllByText("Release")
      .map((element) => element.closest("li"))
      .find((row) => row !== null);
    expect(releaseRow).toHaveTextContent("同名已存在，跳过");
    expect(screen.getByText("Nightly").closest("li")).not.toHaveTextContent(
      "跳过"
    );

    fireEvent.click(screen.getByRole("button", { name: "导入配置" }));

    await waitFor(() => {
      expect(mocks.toastSuccess).toHaveBeenCalledWith("配置已导入", {
        description: "已导入：1 · 同名跳过：1",
      });
    });
  });

  it("后端未导入任何配置时给出警告而不是成功提示", async () => {
    mocks.applyImportedProfiles.mockResolvedValue({
      imported: 0,
      skippedExisting: 1,
      skippedProviderMismatch: 0,
    });
    renderConfigManagementContent();

    await openImportPreview([importedProfile("Release", "dotnet")]);
    fireEvent.click(screen.getByRole("button", { name: "导入配置" }));

    await waitFor(() => {
      expect(mocks.toastWarning).toHaveBeenCalledWith("没有导入任何配置", {
        description: "已导入：0 · 同名跳过：1",
      });
    });
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it("加载被拒绝（Provider 不一致）时保持对话框打开", () => {
    const onClose = vi.fn();
    const onLoadProfile = vi.fn(() => false);
    renderConfigManagementContent({
      profiles: [savedProfile("linux-amd64", "go")],
      repositoryProviderId: "cargo",
      onLoadProfile,
      closeOnLoad: true,
      onClose,
    });

    fireEvent.click(screen.getByRole("button", { name: "加载" }));

    expect(onLoadProfile).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("加载成功后按 closeOnLoad 关闭对话框", () => {
    const onClose = vi.fn();
    renderConfigManagementContent({
      profiles: [savedProfile("Release")],
      closeOnLoad: true,
      onClose,
    });

    fireEvent.click(screen.getByRole("button", { name: "加载" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
