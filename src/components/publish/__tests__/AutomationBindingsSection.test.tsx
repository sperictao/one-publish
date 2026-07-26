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
    providerId: "tauri",
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

function boundView(
  blockedReason: string | null,
  runtimeRevision = "runtime-v1-current",
  expectedRuntimeRevision = runtimeRevision
): AutomationBindingsView {
  return {
    bindings: [
      {
        binding: {
          id: "binding-1",
          configurationId: "profile-1",
          configurationRevisionId: "profile-1-revision-1",
          executionBackendId: "github-actions",
          triggerPolicy: { type: "tagPush", tagPrefix: "v" },
          backendProjection: null,
          runtimeRevision: {},
          externalIdentity: ".github/workflows/one-publish-tauri-release.yml",
          createdAt: "2026-07-22T10:00:00Z",
          updatedAt: "2026-07-22T10:00:00Z",
        },
        configurationName: "Stable",
        blockedReason,
        currentRuntimeRevision: runtimeRevision,
        expectedRuntimeRevision,
        runtimeUpgradeAvailable: runtimeRevision !== expectedRuntimeRevision,
      },
    ],
    drift: blockedReason
      ? [
          {
            path: ".github/workflows/one-publish-tauri-release.yml",
            kind: "updated",
            currentContent: "tampered",
            expectedContent: "expected",
            conflictReleaseNamespace: null,
            conflictDeliveryDestinationNamespace: null,
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
      executionBackendId: "github-actions",
      triggerPolicy: { type: "tagPush", tagPrefix: "v" },
      bindingId: "binding-1",
      confirmedConflictPaths: [".github/workflows/legacy-release.yml"],
    },
    confirmationDigest: "digest-install-1",
    changes: [
      {
        path: ".github/workflows/one-publish-tauri-release.yml",
        kind: "updated",
        currentContent: "name: drifted managed workflow\n",
        expectedContent: '{\n  "revision": "profile-1-revision-1"\n}',
        conflictReleaseNamespace: null,
        conflictDeliveryDestinationNamespace: null,
      },
      {
        path: ".one-publish/automation/github-actions.json",
        kind: "added",
        currentContent: null,
        expectedContent: '{\n  "bindings": {}\n}',
        conflictReleaseNamespace: null,
        conflictDeliveryDestinationNamespace: null,
      },
      {
        path: ".github/workflows/legacy-release.yml",
        kind: "removed",
        currentContent: "on:\n  push:\n    tags: ['v*']\n",
        expectedContent: null,
        conflictReleaseNamespace: "tag:v*",
        conflictDeliveryDestinationNamespace: "github-release:repository",
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
        executionBackendId: "github-actions",
        triggerPolicy: { type: "tagPush", tagPrefix: "v" },
        bindingId: null,
        confirmedConflictPaths: [],
      })
    );

    const diffList = await screen.findByTestId("automation-preview-changes");
    expect(diffList.textContent).toContain(
      ".github/workflows/one-publish-tauri-release.yml"
    );
    expect(diffList.textContent).toContain("name: drifted managed workflow");
    expect(diffList.textContent).toContain(
      ".one-publish/automation/github-actions.json"
    );
    expect(diffList.textContent).toContain("冲突");
    expect(diffList.textContent).toContain("tag:v*");
    expect(diffList.textContent).toContain("github-release:repository");
    expect(diffList.textContent).toContain("tags: ['v*']");
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
          conflictReleaseNamespace: null,
          conflictDeliveryDestinationNamespace: null,
        },
      ],
    });

    renderSection();

    const banner = await screen.findByTestId("automation-drift-banner");
    expect(banner.textContent).toContain(
      "托管投影与仓库不一致，自动发布已阻断"
    );
    expect(banner.textContent).toContain(
      ".github/workflows/one-publish-tauri-release.yml"
    );
    expect(
      screen.getByTestId("automation-binding-blocked-binding-1").textContent
    ).toContain("漂移阻断");

    fireEvent.click(screen.getByRole("button", { name: "更新配置" }));
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

  it("shows runtime revision status and switches only after the projection diff is confirmed", async () => {
    listAutomationBindingsMock.mockResolvedValue(
      boundView(null, "runtime-v1-installed", "runtime-v1-expected")
    );
    previewAutomationChangeMock.mockResolvedValue({
      change: { kind: "upgradeRevision", bindingId: "binding-1" },
      confirmationDigest: "digest-upgrade-1",
      changes: [
        {
          path: ".one-publish/automation/github-actions.json",
          kind: "updated",
          currentContent: '{"runtimeRevision":"runtime-v1-installed"}',
          expectedContent: '{"runtimeRevision":"runtime-v1-expected"}',
          conflictReleaseNamespace: null,
          conflictDeliveryDestinationNamespace: null,
        },
      ],
    });

    renderSection();
    const binding = await screen.findByTestId("automation-binding-binding-1");
    expect(binding.textContent).toContain("当前 Runtime：runtime-v1-installed");
    expect(binding.textContent).toContain("期望 Runtime：runtime-v1-expected");
    expect(binding.textContent).toContain("可升级");

    fireEvent.click(screen.getByRole("button", { name: "升级修订" }));
    await waitFor(() =>
      expect(previewAutomationChangeMock).toHaveBeenCalledWith("repo-1", {
        kind: "upgradeRevision",
        bindingId: "binding-1",
      })
    );
    const diff = await screen.findByTestId("automation-preview-changes");
    expect(diff.textContent).toContain("runtime-v1-installed");
    expect(diff.textContent).toContain("runtime-v1-expected");
    expect(applyAutomationChangeMock).not.toHaveBeenCalled();

    listAutomationBindingsMock.mockResolvedValue(
      boundView(null, "runtime-v1-expected")
    );
    fireEvent.click(screen.getByTestId("automation-confirm-apply"));
    await waitFor(() =>
      expect(applyAutomationChangeMock).toHaveBeenCalledWith(
        "repo-1",
        { kind: "upgradeRevision", bindingId: "binding-1" },
        "digest-upgrade-1"
      )
    );
    const upgraded = await screen.findByTestId("automation-binding-binding-1");
    await waitFor(() =>
      expect(upgraded.textContent).toContain("Runtime 已是最新")
    );
  });

  it("previews detach without applying it implicitly", async () => {
    listAutomationBindingsMock.mockResolvedValue(boundView(null));
    previewAutomationChangeMock.mockResolvedValue({
      change: { kind: "detach", bindingId: "binding-1" },
      confirmationDigest: "digest-detach-1",
      changes: [],
    });

    renderSection();
    await screen.findByTestId("automation-binding-binding-1");
    fireEvent.click(screen.getByRole("button", { name: "解除绑定" }));

    await waitFor(() =>
      expect(previewAutomationChangeMock).toHaveBeenCalledWith("repo-1", {
        kind: "detach",
        bindingId: "binding-1",
      })
    );
    expect(await screen.findByTestId("automation-preview-empty")).toBeTruthy();
    expect(applyAutomationChangeMock).not.toHaveBeenCalled();
  });
});
