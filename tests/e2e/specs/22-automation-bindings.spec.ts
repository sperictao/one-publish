/**
 * 22-automation-bindings — 自动化绑定区的空态与守卫准绳：
 * 仓库配置的 provider 均非 tauri 时展示「无 tauri 配置」提示并禁用
 * 绑定入口；提示内的新建按钮进入快速创建对话框；空绑定视图不出现
 * 漂移横幅。mock 的 list_automation_bindings 返回空视图。
 */
import { test, expect } from "@playwright/test";
import type {
  AutomationBindingsView,
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
});
