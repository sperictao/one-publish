import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { AutomationBindingsSection } from "@/components/publish/AutomationBindingsSection";
import type {
  AutomationBindingsView,
  AutomationProjectionPreview,
} from "@/generated/tauri-contracts";
import type { ConfigProfile } from "@/lib/store/types";

const {
  listAutomationBindingsMock,
  previewAutomationChangeMock,
  applyAutomationChangeMock,
} = vi.hoisted(() => ({
  listAutomationBindingsMock: vi.fn(),
  previewAutomationChangeMock: vi.fn(),
  applyAutomationChangeMock: vi.fn(),
}));

vi.mock("@/lib/automationBindings", () => ({
  listAutomationBindings: listAutomationBindingsMock,
  previewAutomationChange: previewAutomationChangeMock,
  applyAutomationChange: applyAutomationChangeMock,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function createProfile(id: string, name: string): ConfigProfile {
  return {
    id,
    revisionId: `${id}-revision-1`,
    name,
    providerId: "dotnet",
    parameters: { configuration: "Release" },
    profileGroup: null,
    createdAt: "2026-07-21T10:00:00Z",
    isSystemDefault: false,
    externalBindingIds: [],
    blockedReason: null,
  };
}

function emptyView(): AutomationBindingsView {
  return { bindings: [], drift: [] };
}

function boundView(blockedReason: string | null): AutomationBindingsView {
  return {
    bindings: [
      {
        binding: {
          id: "binding-1",
          configurationId: "profile-1",
          configurationRevisionId: "profile-1-revision-1",
          executionBackendId: "fake-automation",
          triggerPolicy: { type: "tagPush", tagPrefix: "v" },
          runtimeRevision: "plan-v1.adapter-v1.fake-automation@1",
          externalIdentity: "one-publish/automation/binding-1.json",
          createdAt: "2026-07-22T10:00:00Z",
          updatedAt: "2026-07-22T10:00:00Z",
        },
        configurationName: "Stable",
        blockedReason,
      },
    ],
    drift: blockedReason
      ? [
          {
            path: "one-publish/automation/binding-1.json",
            kind: "updated",
            currentContent: "tampered",
            expectedContent: "expected",
          },
        ]
      : [],
  };
}

function installPreview(): AutomationProjectionPreview {
  return {
    change: {
      kind: "install",
      configurationId: "profile-1",
      executionBackendId: "fake-automation",
      triggerPolicy: { type: "tagPush", tagPrefix: "v" },
      bindingId: "binding-1",
    },
    confirmationDigest: "digest-install-1",
    changes: [
      {
        path: "one-publish/automation/binding-1.json",
        kind: "added",
        currentContent: null,
        expectedContent: '{\n  "revision": "profile-1-revision-1"\n}',
      },
      {
        path: "one-publish/automation/bundle.json",
        kind: "added",
        currentContent: null,
        expectedContent: '{\n  "bindings": {}\n}',
      },
    ],
  };
}

function renderSection(
  profiles: ConfigProfile[] = [createProfile("profile-1", "Stable")]
) {
  return render(
    <AutomationBindingsSection
      repoId="repo-1"
      profiles={profiles}
      configPanelT={{}}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  applyAutomationChangeMock.mockResolvedValue({
    commitSha: "abc123",
    pushedBranch: "main",
    bindings: [],
  });
});

describe("AutomationBindingsSection", () => {
  it("installs a binding only after the full projection diff is confirmed", async () => {
    listAutomationBindingsMock.mockResolvedValue(emptyView());
    previewAutomationChangeMock.mockResolvedValue(installPreview());

    renderSection();
    await waitFor(() =>
      expect(listAutomationBindingsMock).toHaveBeenCalledWith("repo-1")
    );
    expect(screen.getByText("尚未绑定远端自动化")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "绑定自动化" }));
    fireEvent.click(screen.getByRole("button", { name: "预览投影差异" }));

    await waitFor(() =>
      expect(previewAutomationChangeMock).toHaveBeenCalledWith("repo-1", {
        kind: "install",
        configurationId: "profile-1",
        executionBackendId: "fake-automation",
        triggerPolicy: { type: "tagPush", tagPrefix: "v" },
        bindingId: null,
      })
    );

    const diffList = await screen.findByTestId("automation-preview-changes");
    expect(diffList.textContent).toContain(
      "one-publish/automation/binding-1.json"
    );
    expect(diffList.textContent).toContain(
      "one-publish/automation/bundle.json"
    );
    expect(applyAutomationChangeMock).not.toHaveBeenCalled();

    listAutomationBindingsMock.mockResolvedValue(boundView(null));
    fireEvent.click(screen.getByTestId("automation-confirm-apply"));

    await waitFor(() =>
      expect(applyAutomationChangeMock).toHaveBeenCalledWith(
        "repo-1",
        installPreview().change,
        "digest-install-1"
      )
    );
    await waitFor(() =>
      expect(listAutomationBindingsMock).toHaveBeenCalledTimes(2)
    );
    expect(await screen.findByText("Stable")).toBeTruthy();
  });

  it("shows drift as a blocking state and reconciles through preview and apply", async () => {
    listAutomationBindingsMock.mockResolvedValue(
      boundView("automation_projection_drift")
    );
    previewAutomationChangeMock.mockResolvedValue({
      change: { kind: "reconcile" },
      confirmationDigest: "digest-reconcile-1",
      changes: [
        {
          path: "one-publish/automation/binding-1.json",
          kind: "updated",
          currentContent: "tampered",
          expectedContent: "expected",
        },
      ],
    });

    renderSection();

    const banner = await screen.findByTestId("automation-drift-banner");
    expect(banner.textContent).toContain(
      "托管投影与仓库不一致，自动发布已阻断"
    );
    expect(banner.textContent).toContain(
      "one-publish/automation/binding-1.json"
    );
    expect(
      screen.getByTestId("automation-binding-blocked-binding-1").textContent
    ).toContain("漂移阻断");

    fireEvent.click(screen.getByRole("button", { name: "协调漂移" }));
    await waitFor(() =>
      expect(previewAutomationChangeMock).toHaveBeenCalledWith("repo-1", {
        kind: "reconcile",
      })
    );

    listAutomationBindingsMock.mockResolvedValue(boundView(null));
    fireEvent.click(await screen.findByTestId("automation-confirm-apply"));
    await waitFor(() =>
      expect(applyAutomationChangeMock).toHaveBeenCalledWith(
        "repo-1",
        { kind: "reconcile" },
        "digest-reconcile-1"
      )
    );
  });

  it("previews upgrade and detach changes for an existing binding", async () => {
    listAutomationBindingsMock.mockResolvedValue(boundView(null));
    previewAutomationChangeMock.mockResolvedValue({
      change: { kind: "upgradeRevision", bindingId: "binding-1" },
      confirmationDigest: "digest-upgrade-1",
      changes: [],
    });

    renderSection();
    await screen.findByTestId("automation-binding-binding-1");

    fireEvent.click(screen.getByRole("button", { name: "升级修订" }));
    await waitFor(() =>
      expect(previewAutomationChangeMock).toHaveBeenCalledWith("repo-1", {
        kind: "upgradeRevision",
        bindingId: "binding-1",
      })
    );
    expect(await screen.findByTestId("automation-preview-empty")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    fireEvent.click(screen.getByRole("button", { name: "解除绑定" }));
    await waitFor(() =>
      expect(previewAutomationChangeMock).toHaveBeenCalledWith("repo-1", {
        kind: "detach",
        bindingId: "binding-1",
      })
    );
    expect(applyAutomationChangeMock).not.toHaveBeenCalled();
  });
});
