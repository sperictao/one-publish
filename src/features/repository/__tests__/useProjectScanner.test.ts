import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const apiMocks = vi.hoisted(() => ({
  scanProject: vi.fn(),
  resolveProjectInfo: vi.fn(),
  scanProjectCandidates: vi.fn(),
}));

vi.mock("@/lib/store/api", () => apiMocks);

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { error: toastMocks.error, success: toastMocks.success },
}));

vi.mock("@/hooks/useI18n", () => ({
  useI18n: () => ({ translations: {}, t: (k: string) => k }),
}));

import { useProjectScanner } from "@/features/repository/useProjectScanner";

function setup() {
  return renderHook(() => useProjectScanner({ appT: {} })).result.current;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("scanProject", () => {
  it("returns project info and shows a success toast", async () => {
    const info = { project_file: "/repo/App.csproj" };
    apiMocks.scanProject.mockResolvedValue(info);
    const scanner = setup();

    await expect(scanner.scanProject("/repo")).resolves.toEqual(info);
    expect(apiMocks.scanProject).toHaveBeenCalledWith("/repo");
    expect(toastMocks.success).toHaveBeenCalledWith(
      "项目检测成功",
      expect.objectContaining({
        description: expect.stringContaining("/repo/App.csproj"),
      })
    );
  });

  it("suppresses the success toast when silentSuccess is set", async () => {
    apiMocks.scanProject.mockResolvedValue({
      project_file: "/repo/App.csproj",
    });
    const scanner = setup();

    await scanner.scanProject("/repo", { silentSuccess: true });
    expect(toastMocks.success).not.toHaveBeenCalled();
  });

  it("maps known failure codes to dedicated toasts and returns null", async () => {
    apiMocks.scanProject.mockRejectedValue({ code: "path_not_found" });
    const scanner = setup();

    await expect(scanner.scanProject("/missing")).resolves.toBeNull();
    expect(toastMocks.error).toHaveBeenCalledWith(
      "Project Root 路径不存在",
      expect.objectContaining({
        description: expect.stringContaining("Project Root"),
      })
    );
  });

  it("covers each failure-reason branch", async () => {
    const scanner = setup();
    const cases: Array<[string, string]> = [
      ["project_root_not_found", "未检测到项目根目录"],
      ["project_file_not_found", "未检测到项目文件"],
      ["multiple_project_files_found", "检测到多个项目文件"],
      ["permission_denied", "缺少目录访问权限"],
      ["current_dir_failed", "读取当前目录失败"],
    ];

    for (const [code, title] of cases) {
      apiMocks.scanProject.mockRejectedValueOnce({ code });
      await scanner.scanProject("/repo");
      expect(toastMocks.error).toHaveBeenLastCalledWith(
        title,
        expect.anything()
      );
    }
  });

  it("falls back to a generic toast with a localized description", async () => {
    apiMocks.scanProject.mockRejectedValue(new Error("mystery"));
    const scanner = setup();

    await scanner.scanProject("/repo");
    expect(toastMocks.error).toHaveBeenCalledWith(
      "项目检测失败",
      expect.objectContaining({ description: expect.any(String) })
    );
  });

  it("suppresses failure toasts when silentFailure is set", async () => {
    apiMocks.scanProject.mockRejectedValue({ code: "path_not_found" });
    const scanner = setup();

    await expect(
      scanner.scanProject("/missing", { silentFailure: true })
    ).resolves.toBeNull();
    expect(toastMocks.error).not.toHaveBeenCalled();
  });
});

describe("scanProjectCandidates / resolveProjectInfo", () => {
  it("returns candidates on success and null on failure", async () => {
    const candidates = { candidates: ["/repo/A.csproj"] };
    apiMocks.scanProjectCandidates.mockResolvedValue(candidates);
    const scanner = setup();

    await expect(scanner.scanProjectCandidates("/repo")).resolves.toEqual(
      candidates
    );

    apiMocks.scanProjectCandidates.mockRejectedValue({ code: "x" });
    await expect(scanner.scanProjectCandidates("/repo")).resolves.toBeNull();
  });

  it("resolves project info for an explicit file", async () => {
    const info = { project_file: "/repo/B.csproj" };
    apiMocks.resolveProjectInfo.mockResolvedValue(info);
    const scanner = setup();

    await expect(scanner.resolveProjectInfo("/repo/B.csproj")).resolves.toEqual(
      info
    );
    expect(apiMocks.resolveProjectInfo).toHaveBeenCalledWith("/repo/B.csproj");

    apiMocks.resolveProjectInfo.mockRejectedValue(new Error("nope"));
    await expect(
      scanner.resolveProjectInfo("/repo/B.csproj", { silentFailure: true })
    ).resolves.toBeNull();
  });
});
