import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import { scanProjectCandidates } from "@/lib/store/api";

describe("store api wrappers", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("scanProjectCandidates passes the selected path using Tauri's camelCase argument key", async () => {
    invokeMock.mockResolvedValue({
      rootPath: "/tmp/demo-repo",
      solutionFiles: ["/tmp/demo-repo/App.sln"],
      projectFiles: ["/tmp/demo-repo/src/App/App.csproj"],
      recommendedProjectFile: "/tmp/demo-repo/src/App/App.csproj",
    });

    const result = await scanProjectCandidates("/tmp/demo-repo");

    expect(invokeMock).toHaveBeenCalledWith("scan_project_candidates", {
      startPath: "/tmp/demo-repo",
    });
    expect(result.recommendedProjectFile).toBe(
      "/tmp/demo-repo/src/App/App.csproj"
    );
  });

  it("scanProjectCandidates normalizes null recommendations to undefined", async () => {
    invokeMock.mockResolvedValue({
      rootPath: "/tmp/demo-repo",
      solutionFiles: [],
      projectFiles: [],
      recommendedProjectFile: null,
    });

    const result = await scanProjectCandidates("/tmp/demo-repo");

    expect(result.recommendedProjectFile).toBeUndefined();
  });
});
