/**
 * 22-automation-bindings — 自动化绑定区的空态与守卫准绳：
 * 仓库配置的 provider 均非 tauri 时展示「无 tauri 配置」提示并禁用
 * 绑定入口；提示内的新建按钮进入快速创建对话框；空绑定视图不出现
 * 漂移横幅。mock 的 list_automation_bindings 返回空视图。
 */
import { test, expect } from "@playwright/test";
import type {
  AutomationBindingsView,
  AutomationProjectionPreview,
  RemoteAttemptEvidenceView,
} from "@/generated/tauri-contracts";
import { gotoApp } from "../fixtures/mock-tauri";

const SEEDED_BINDINGS: AutomationBindingsView = {
  bindings: [
    {
      binding: {
        id: "binding-1",
        configurationId: "profile-folder",
        configurationRevisionId: "profile-folder-revision-1",
        executionBackendId: "github-actions",
        triggerPolicy: { type: "tagPush", tagPrefix: "v" },
        backendProjection: {},
        runtimeRevision: {},
        externalIdentity: "deploy.yml",
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-01T00:00:00Z",
      },
      configurationName: "FolderProfile",
      blockedReason: null,
      currentRuntimeRevision: "1",
      expectedRuntimeRevision: "1",
      runtimeUpgradeAvailable: false,
    },
  ],
  drift: [],
};

const RUNNING_EVIDENCE: RemoteAttemptEvidenceView[] = [
  {
    attemptId: "e2e-attempt-1",
    bindingId: "binding-1",
    runId: 42,
    state: { kind: "archived", status: "running", error: null },
  },
];

const RUNTIME_PROJECTION_PATH = ".github/automation/runtime/release.json";

const SEEDED_PREVIEW: AutomationProjectionPreview = {
  change: {
    kind: "install",
    configurationId: "profile-tauri",
    triggerPolicy: { type: "tagPush", tagPrefix: "v" },
    bindingId: null,
    confirmedConflictPaths: [],
  },
  confirmationDigest: "e2e-digest",
  changes: [
    {
      path: ".github/workflows/deploy.yml",
      kind: "added",
      currentContent: null,
      expectedContent: "name: deploy",
      conflictReleaseNamespace: null,
      conflictDeliveryDestinationNamespace: null,
    },
    {
      path: RUNTIME_PROJECTION_PATH,
      kind: "added",
      currentContent: null,
      expectedContent: JSON.stringify({
        runtime_revision: {
          version: 1,
          digest: "rev-digest",
          runner: {
            version: "0.1.0",
            binary_digests: { "x86_64-linux": "sha256-abcdef" },
          },
        },
      }),
      conflictReleaseNamespace: null,
      conflictDeliveryDestinationNamespace: null,
    },
  ],
};

test.describe("Automation bindings section", () => {
  test("renders for the selected repository", async ({ page }) => {
    await gotoApp(page);
    await expect(page.getByTestId("automation-bindings-section")).toBeVisible({
      timeout: 10000,
    });
  });

  test("shows the no-tauri-profile hint and disables install", async ({
    page,
  }) => {
    await gotoApp(page);
    await expect(page.getByTestId("automation-no-tauri-profile")).toBeVisible({
      timeout: 10000,
    });
    await expect(
      page.getByRole("button", { name: /绑定自动化/ })
    ).toBeDisabled();
  });

  test("empty bindings view renders no drift banner", async ({ page }) => {
    await gotoApp(page);
    await expect(page.getByTestId("automation-bindings-section")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByTestId("automation-drift-banner")).toHaveCount(0);
  });

  test("hint's create-profile button opens the quick-create dialog", async ({
    page,
  }) => {
    await gotoApp(page);
    const hint = page.getByTestId("automation-no-tauri-profile");
    await expect(hint).toBeVisible({ timeout: 10000 });
    await hint.getByRole("button", { name: "新建配置" }).click();
    await expect(
      page.getByRole("dialog", { name: "创建发布配置" })
    ).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Automation bindings — seeded view", () => {
  test("renders seeded binding rows with configuration and backend", async ({
    page,
  }) => {
    await gotoApp(page, { automationBindings: SEEDED_BINDINGS });
    const row = page.getByTestId("automation-binding-binding-1");
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row).toContainText("FolderProfile");
    await expect(row).toContainText("github-actions");
    await expect(
      page.getByTestId("automation-runtime-status-binding-1")
    ).toBeVisible();
    await expect(
      page.getByTestId("automation-dispatch-binding-1")
    ).toBeVisible();
  });

  test("sync surfaces remote evidence and cancel invokes the command", async ({
    page,
  }) => {
    await gotoApp(page, {
      automationBindings: SEEDED_BINDINGS,
      remoteEvidence: RUNNING_EVIDENCE,
    });
    const evidence = page.getByTestId("automation-remote-evidence");
    await expect(evidence).toBeVisible({ timeout: 10000 });
    await evidence.getByRole("button", { name: /同步远端证据/ }).click();
    await expect(
      page.getByTestId("automation-remote-attempt-e2e-attempt-1")
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByTestId("automation-remote-cancel-e2e-attempt-1")
    ).toBeVisible();

    await page.getByTestId("automation-remote-cancel-e2e-attempt-1").click();
    await expect
      .poll(async () =>
        page.evaluate(() =>
          (
            window as unknown as { __MOCK_INVOCATIONS__: string[] }
          ).__MOCK_INVOCATIONS__.includes("cancel_remote_publish_run")
        )
      )
      .toBe(true);
  });

  test("dispatch dialog triggers the manual run and refreshes evidence", async ({
    page,
  }) => {
    await gotoApp(page, { automationBindings: SEEDED_BINDINGS });
    await page.getByTestId("automation-dispatch-binding-1").click();
    await page.getByLabel(/发布版本/).fill("1.2.3");
    await page.getByTestId("automation-dispatch-confirm").click();
    await expect(
      page.locator("[data-sonner-toast]", { hasText: "已触发远端发布" })
    ).toBeVisible({ timeout: 10000 });
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const calls = (
            window as unknown as { __MOCK_INVOCATIONS__: string[] }
          ).__MOCK_INVOCATIONS__;
          return (
            calls.includes("dispatch_manual_publish_run") &&
            calls.includes("synchronize_remote_publish_evidence")
          );
        })
      )
      .toBe(true);
  });

  test("drift and blocked badges render for a drifted binding", async ({
    page,
  }) => {
    const drifted: AutomationBindingsView = {
      bindings: [
        {
          ...SEEDED_BINDINGS.bindings[0],
          blockedReason: "projection drift detected",
        },
      ],
      drift: [
        {
          path: ".github/workflows/deploy.yml",
          kind: "updated",
          currentContent: "on: push",
          expectedContent: "on: workflow_dispatch",
          conflictReleaseNamespace: null,
          conflictDeliveryDestinationNamespace: null,
        },
      ],
    };
    await gotoApp(page, { automationBindings: drifted });
    await expect(page.getByTestId("automation-drift-banner")).toBeVisible({
      timeout: 10000,
    });
    await expect(
      page.getByTestId("automation-binding-blocked-binding-1")
    ).toBeVisible();
  });

  test("terminal and expired evidence render without cancel affordances", async ({
    page,
  }) => {
    const evidence: RemoteAttemptEvidenceView[] = [
      {
        attemptId: "e2e-published",
        bindingId: "binding-1",
        runId: 7,
        state: { kind: "archived", status: "published", error: null },
      },
      {
        attemptId: "e2e-expired",
        bindingId: "binding-1",
        runId: 8,
        state: { kind: "expired", missing: ["receipt"] },
      },
    ];
    await gotoApp(page, {
      automationBindings: SEEDED_BINDINGS,
      remoteEvidence: evidence,
    });
    await page
      .getByTestId("automation-remote-evidence")
      .getByRole("button", { name: /同步远端证据/ })
      .click();
    await expect(
      page.getByTestId("automation-remote-attempt-e2e-published")
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByTestId("automation-remote-expired-e2e-expired")
    ).toBeVisible();
    await expect(
      page.getByTestId("automation-remote-cancel-e2e-published")
    ).toHaveCount(0);
    await expect(
      page.getByTestId("automation-remote-cancel-e2e-expired")
    ).toHaveCount(0);
  });

  test("missing-segments and failed evidence render their markers", async ({
    page,
  }) => {
    const evidence: RemoteAttemptEvidenceView[] = [
      {
        attemptId: "e2e-failed",
        bindingId: "binding-1",
        runId: 9,
        state: {
          kind: "archived",
          status: "failed",
          error: "upload step timed out",
        },
      },
      {
        attemptId: "e2e-missing",
        bindingId: "binding-1",
        runId: 10,
        state: { kind: "missingSegments", missing: ["receipt", "manifest"] },
      },
    ];
    await gotoApp(page, {
      automationBindings: SEEDED_BINDINGS,
      remoteEvidence: evidence,
    });
    await page
      .getByTestId("automation-remote-evidence")
      .getByRole("button", { name: /同步远端证据/ })
      .click();
    const failedRow = page.getByTestId("automation-remote-attempt-e2e-failed");
    await expect(failedRow).toBeVisible({ timeout: 10000 });
    const missingRow = page.getByTestId(
      "automation-remote-attempt-e2e-missing"
    );
    await expect(missingRow).toBeVisible();
    await expect(missingRow).toContainText("证据缺失");
    await expect(missingRow).toContainText("receipt");
    await expect(
      page.getByTestId("automation-remote-cancel-e2e-failed")
    ).toHaveCount(0);
    await expect(
      page.getByTestId("automation-remote-cancel-e2e-missing")
    ).toHaveCount(0);
  });
});

test.describe("Automation bindings — change flows", () => {
  const seededApply = {
    commitSha: "abc123",
    pushedBranch: "main",
    bindings: [],
  };

  async function applySeededPreview(
    page: import("@playwright/test").Page
  ): Promise<Record<string, unknown> | undefined> {
    await expect(page.getByTestId("automation-preview-changes")).toBeVisible({
      timeout: 10000,
    });
    await page.getByTestId("automation-confirm-apply").click();
    await expect(
      page.locator("[data-sonner-toast]", { hasText: "自动化投影已应用" })
    ).toBeVisible({ timeout: 10000 });
    return page.evaluate(() => {
      const entries = (
        window as unknown as {
          __MOCK_INVOKE_ARGS__: {
            cmd: string;
            args?: Record<string, unknown>;
          }[];
        }
      ).__MOCK_INVOKE_ARGS__;
      return entries.find((entry) => entry.cmd === "apply_automation_change")
        ?.args;
    });
  }

  test("detach flow previews and applies the unbind request", async ({
    page,
  }) => {
    await gotoApp(page, {
      automationBindings: SEEDED_BINDINGS,
      automationPreview: {
        change: { kind: "detach", bindingId: "binding-1" },
        confirmationDigest: "detach-digest",
        changes: [
          {
            path: ".github/workflows/deploy.yml",
            kind: "removed",
            currentContent: "name: deploy",
            expectedContent: null,
            conflictReleaseNamespace: null,
            conflictDeliveryDestinationNamespace: null,
          },
        ],
      },
      automationApplyResult: seededApply,
    });
    await page.getByRole("button", { name: "解除绑定" }).click();
    const applyArgs = await applySeededPreview(page);
    expect((applyArgs?.change as { kind?: string } | undefined)?.kind).toBe(
      "detach"
    );
    expect(applyArgs?.confirmedDigest).toBe("detach-digest");
  });

  test("upgrade flow previews and applies the revision upgrade", async ({
    page,
  }) => {
    await gotoApp(page, {
      automationBindings: SEEDED_BINDINGS,
      automationPreview: {
        change: { kind: "upgradeRevision", bindingId: "binding-1" },
        confirmationDigest: "upgrade-digest",
        changes: [
          {
            path: ".github/workflows/deploy.yml",
            kind: "updated",
            currentContent: "runner v0.1.0",
            expectedContent: "runner v0.2.0",
            conflictReleaseNamespace: null,
            conflictDeliveryDestinationNamespace: null,
          },
        ],
      },
      automationApplyResult: seededApply,
    });
    await page.getByRole("button", { name: "升级修订" }).click();
    const applyArgs = await applySeededPreview(page);
    expect((applyArgs?.change as { kind?: string } | undefined)?.kind).toBe(
      "upgradeRevision"
    );
  });

  test("drift banner reconcile flow applies the reconcile request", async ({
    page,
  }) => {
    const drifted: AutomationBindingsView = {
      bindings: [SEEDED_BINDINGS.bindings[0]],
      drift: [
        {
          path: ".github/workflows/deploy.yml",
          kind: "updated",
          currentContent: "on: push",
          expectedContent: "on: workflow_dispatch",
          conflictReleaseNamespace: null,
          conflictDeliveryDestinationNamespace: null,
        },
      ],
    };
    await gotoApp(page, {
      automationBindings: drifted,
      automationPreview: {
        change: { kind: "reconcile" },
        confirmationDigest: "reconcile-digest",
        changes: [
          {
            path: ".github/workflows/deploy.yml",
            kind: "updated",
            currentContent: "on: push",
            expectedContent: "on: workflow_dispatch",
            conflictReleaseNamespace: null,
            conflictDeliveryDestinationNamespace: null,
          },
        ],
      },
      automationApplyResult: seededApply,
    });
    await expect(page.getByTestId("automation-drift-banner")).toBeVisible({
      timeout: 10000,
    });
    await page
      .getByTestId("automation-drift-banner")
      .getByRole("button", { name: "更新配置" })
      .click();
    const applyArgs = await applySeededPreview(page);
    expect((applyArgs?.change as { kind?: string } | undefined)?.kind).toBe(
      "reconcile"
    );
  });
});

test.describe("Automation bindings — install flow", () => {
  test("preview renders runtime section and apply echoes the digest", async ({
    page,
  }) => {
    await gotoApp(page, {
      seedTauriProfile: true,
      automationPreview: SEEDED_PREVIEW,
      automationApplyResult: {
        commitSha: "abc123",
        pushedBranch: "main",
        bindings: [],
      },
    });

    const installButton = page.getByRole("button", { name: "绑定自动化" });
    await expect(installButton).toBeEnabled({ timeout: 10000 });
    await installButton.click();
    await page.getByRole("button", { name: "预览投影差异" }).click();

    await expect(page.getByTestId("automation-preview-changes")).toBeVisible({
      timeout: 10000,
    });
    await expect(
      page.getByTestId(`automation-runtime-section-${RUNTIME_PROJECTION_PATH}`)
    ).toBeVisible();

    await page.getByTestId("automation-confirm-apply").click();
    await expect(
      page.locator("[data-sonner-toast]", { hasText: "自动化投影已应用" })
    ).toBeVisible({ timeout: 10000 });

    const calls = await page.evaluate(() => {
      const entries = (
        window as unknown as {
          __MOCK_INVOKE_ARGS__: {
            cmd: string;
            args?: Record<string, unknown>;
          }[];
        }
      ).__MOCK_INVOKE_ARGS__;
      return {
        previewCalled: entries.some(
          (entry) => entry.cmd === "preview_automation_change"
        ),
        applyArgs: entries.find(
          (entry) => entry.cmd === "apply_automation_change"
        )?.args,
      };
    });
    expect(calls.previewCalled).toBe(true);
    expect(calls.applyArgs?.confirmedDigest).toBe("e2e-digest");
  });
});
