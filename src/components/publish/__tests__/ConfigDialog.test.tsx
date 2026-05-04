import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  openDialog: vi.fn(),
  importConfig: vi.fn(),
  refreshProfiles: vi.fn(),
  saveProfile: vi.fn(),
  deleteProfile: vi.fn(),
  exportProfiles: vi.fn(),
  applyImportedProfiles: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: mocks.openDialog,
}));

vi.mock("sonner", () => ({
  toast: {
    success: mocks.toastSuccess,
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

vi.mock("@/lib/store", async () => {
  const actual = await vi.importActual<typeof import("@/lib/store")>("@/lib/store");
  return {
    ...actual,
    importConfig: mocks.importConfig,
  };
});

import { ConfigManagementContent } from "@/components/publish/ConfigDialog";
import type { ConfigParameters, ConfigProfile } from "@/lib/store";

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
    mocks.refreshProfiles.mockResolvedValue([]);
    mocks.saveProfile.mockResolvedValue(undefined);
    mocks.deleteProfile.mockResolvedValue(undefined);
    mocks.exportProfiles.mockResolvedValue(undefined);
    mocks.applyImportedProfiles.mockResolvedValue(undefined);
  });

  function renderConfigManagementContent({
    profiles = [],
    currentParameters = {},
  }: {
    profiles?: ConfigProfile[];
    currentParameters?: ConfigParameters;
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
        onLoadProfile={vi.fn()}
        currentProviderId="dotnet"
        repoId="repo-1"
        currentParameters={currentParameters}
      />
    );
  }

  it("打开后通过 profile owner 刷新，并渲染 owner 提供的列表", async () => {
    renderConfigManagementContent({
      profiles: [
        {
          name: "Release",
          providerId: "dotnet",
          parameters: {},
          profileGroup: null,
          createdAt: "2026-04-02T12:00:00.000Z",
          isSystemDefault: false,
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
    expect(mocks.toastSuccess).toHaveBeenCalledWith("配置文件保存成功");
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
      expect(mocks.importConfig).toHaveBeenCalledWith("/tmp/one-publish-config.json");
    });

    expect(mocks.applyImportedProfiles).not.toHaveBeenCalled();
    expect(screen.getByText("确认导入配置")).toBeInTheDocument();
    expect(screen.getByText("待导入配置")).toBeInTheDocument();
    expect(screen.getByText("Release")).toBeInTheDocument();
    expect(screen.getByText("Nightly")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "确认导入" }));

    await waitFor(() => {
      expect(mocks.applyImportedProfiles).toHaveBeenCalledWith(importedProfiles);
    });
  });
});
