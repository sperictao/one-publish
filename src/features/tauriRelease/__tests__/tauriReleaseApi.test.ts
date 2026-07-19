import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import {
  applyTauriWorkflowTakeover,
  startTauriGithubRelease,
} from "@/features/tauriRelease/tauriReleaseApi";

describe("Tauri release API", () => {
  beforeEach(() => invokeMock.mockReset());

  it("requires the explicit confirmed flag for workflow takeover", async () => {
    invokeMock.mockResolvedValue({});

    await applyTauriWorkflowTakeover("repo-1", "preview-1");

    expect(invokeMock).toHaveBeenCalledWith("apply_tauri_workflow_takeover", {
      repositoryId: "repo-1",
      previewId: "preview-1",
      confirmed: true,
    });
  });

  it("passes the preflight identity and per-release unsigned confirmation", async () => {
    invokeMock.mockResolvedValue({});
    const request = {
      repositoryId: "repo-1",
      preflightId: "preflight-1",
      version: "1.2.3",
      releaseNotes: "- Added Tauri publishing",
      confirmUnsignedRelease: true,
    };

    await startTauriGithubRelease(request);

    expect(invokeMock).toHaveBeenCalledWith("start_tauri_github_release", {
      request,
    });
  });
});
