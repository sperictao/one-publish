import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import {
  applyAutomationChange,
  cancelRemotePublishRun,
  dispatchManualPublishRun,
  listAutomationBindings,
  previewAutomationChange,
  synchronizeRemoteEvidence,
} from "@/lib/automationBindings";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({});
});

describe("automation bindings invoke boundary", () => {
  it("lists bindings for a repo", async () => {
    await listAutomationBindings("repo-1");
    expect(invokeMock).toHaveBeenCalledWith("list_automation_bindings", {
      repoId: "repo-1",
    });
  });

  it("previews a change request", async () => {
    const change = { kind: "enable" };
    await previewAutomationChange("repo-1", change as never);
    expect(invokeMock).toHaveBeenCalledWith("preview_automation_change", {
      repoId: "repo-1",
      change,
    });
  });

  it("applies a change with the confirmed digest", async () => {
    const change = { kind: "disable" };
    await applyAutomationChange("repo-1", change as never, "digest-1");
    expect(invokeMock).toHaveBeenCalledWith("apply_automation_change", {
      repoId: "repo-1",
      change,
      confirmedDigest: "digest-1",
    });
  });

  it("synchronizes remote evidence", async () => {
    await synchronizeRemoteEvidence("repo-1");
    expect(invokeMock).toHaveBeenCalledWith(
      "synchronize_remote_publish_evidence",
      { repoId: "repo-1" }
    );
  });

  it("dispatches a manual run with binding and version", async () => {
    await dispatchManualPublishRun("repo-1", "binding-9", "v1.2.3");
    expect(invokeMock).toHaveBeenCalledWith("dispatch_manual_publish_run", {
      repoId: "repo-1",
      bindingId: "binding-9",
      version: "v1.2.3",
    });
  });

  it("cancels a remote run", async () => {
    await cancelRemotePublishRun("repo-1", 42);
    expect(invokeMock).toHaveBeenCalledWith("cancel_remote_publish_run", {
      repoId: "repo-1",
      runId: 42,
    });
  });
});
