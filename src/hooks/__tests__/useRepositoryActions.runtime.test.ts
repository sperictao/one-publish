import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openDialog: vi.fn(),
  detectRepositoryProvider: vi.fn(),
  addRepository: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: vi.fn(),
  open: mocks.openDialog,
}));

vi.mock("sonner", () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}));

vi.mock("@/lib/store", async () => {
  const actual = await vi.importActual<typeof import("@/lib/store")>("@/lib/store");
  return {
    ...actual,
    detectRepositoryProvider: mocks.detectRepositoryProvider,
  };
});

import { handleAddRepoRuntime } from "@/hooks/useRepositoryActions.runtime";

describe("handleAddRepoRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.openDialog.mockResolvedValue("/tmp/demo-repo");
    mocks.detectRepositoryProvider.mockResolvedValue("dotnet");
    mocks.addRepository.mockResolvedValue(undefined);
  });

  it("新增仓库时会写入检测到的 providerId", async () => {
    await handleAddRepoRuntime({
      appT: {
        selectRepositoryDirectory: "选择仓库目录",
        repositoryAdded: "仓库已添加",
      },
      addRepository: mocks.addRepository,
    });

    expect(mocks.detectRepositoryProvider).toHaveBeenCalledWith("/tmp/demo-repo");
    expect(mocks.addRepository).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "demo-repo",
        path: "/tmp/demo-repo",
        providerId: "dotnet",
      })
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith("仓库已添加", {
      description: "demo-repo",
    });
  });
});
