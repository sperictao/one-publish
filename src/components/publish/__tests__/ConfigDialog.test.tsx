import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  openDialog: vi.fn(),
  getProfiles: vi.fn(),
  saveProfile: vi.fn(),
  deleteProfile: vi.fn(),
  exportConfig: vi.fn(),
  importConfig: vi.fn(),
  applyImportedConfig: vi.fn(),
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
    getProfiles: mocks.getProfiles,
    saveProfile: mocks.saveProfile,
    deleteProfile: mocks.deleteProfile,
    exportConfig: mocks.exportConfig,
    importConfig: mocks.importConfig,
    applyImportedConfig: mocks.applyImportedConfig,
  };
});

import { ConfigManagementContent } from "@/components/publish/ConfigDialog";

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
    mocks.getProfiles.mockResolvedValue([]);
    mocks.openDialog.mockResolvedValue("/tmp/one-publish-config.json");
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
    mocks.applyImportedConfig.mockResolvedValue(undefined);

    render(
      <ConfigManagementContent
        active
        onLoadProfile={vi.fn()}
        currentProviderId="dotnet"
        repoId="repo-1"
        currentParameters={{}}
      />
    );

    await waitFor(() => {
      expect(mocks.getProfiles).toHaveBeenCalledWith("repo-1");
    });

    fireEvent.click(screen.getByRole("button", { name: "导入配置" }));

    await waitFor(() => {
      expect(mocks.importConfig).toHaveBeenCalledWith("/tmp/one-publish-config.json");
    });

    expect(mocks.applyImportedConfig).not.toHaveBeenCalled();
    expect(screen.getByText("确认导入配置")).toBeInTheDocument();
    expect(screen.getByText("待导入配置")).toBeInTheDocument();
    expect(screen.getByText("Release")).toBeInTheDocument();
    expect(screen.getByText("Nightly")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "确认导入" }));

    await waitFor(() => {
      expect(mocks.applyImportedConfig).toHaveBeenCalledWith(
        "repo-1",
        importedProfiles
      );
    });
  });
});
