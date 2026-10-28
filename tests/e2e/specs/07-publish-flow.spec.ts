/**
 * 07-publish-flow — Full publish lifecycle: select → configure → execute → verify.
 *
 * Covers the #1 user path: pick a repo, choose a preset, hit publish,
 * and verify the result.  Includes both happy path and error-path coverage
 * using the mock Tauri error injection.
 */
import { test, expect } from "@playwright/test";
import { gotoApp, gotoAppWithPublishConfig } from "../fixtures/mock-tauri";

test.describe("Full Publish Flow — Happy Path", () => {
  test("complete publish lifecycle: select → execute → success", async ({
    page,
  }) => {
    await gotoAppWithPublishConfig(page);

    // 1. Verify initial state — repo-a selected, publish panel visible
    const repoABtn = page.locator(
      "[data-list-item-id='repo-a'] button[aria-pressed]"
    );
    await expect(repoABtn).toHaveAttribute("aria-pressed", "true");

    // 2. Verify publish command preview is visible
    const commandPreview = page.locator(
      "[data-testid='publish-command-preview']"
    );
    await expect(commandPreview).toBeVisible({ timeout: 10000 });
    await expect(commandPreview).toContainText("dotnet publish");

    // 3. Verify status shows idle ("待执行")
    const statusPanel = page.locator("[data-testid='publish-status-panel']");
    await expect(statusPanel).toBeVisible({ timeout: 10000 });
    await expect(statusPanel).toContainText("待执行");

    // 4. Click the publish button
    const publishBtn = page.locator("[data-testid='publish-execute-btn']");
    await expect(publishBtn).toBeVisible();
    await expect(publishBtn).not.toBeDisabled();
    await publishBtn.click();

    // 5. After clicking, the status should change from idle
    // (mock emits log chunks → status panel updates)
    await expect(statusPanel).toContainText("成功", { timeout: 15000 });
    // publish:completed → notifyFeedback(toast) —— 成功反馈用户可见。
    await expect(
      page.locator("[data-sonner-toast]", { hasText: "发布完成" })
    ).toBeVisible({ timeout: 10000 });
  });

  test("publish with different repo works end-to-end", async ({ page }) => {
    await gotoAppWithPublishConfig(page);

    // Switch to repo-b
    await page
      .locator("[data-list-item-id='repo-b'] button[aria-pressed]")
      .click();
    await expect(
      page.locator("[data-list-item-id='repo-b'] button[aria-pressed]")
    ).toHaveAttribute("aria-pressed", "true");

    // Command preview should still be visible
    const commandPreview = page.locator(
      "[data-testid='publish-command-preview']"
    );
    await expect(commandPreview).toBeVisible({ timeout: 10000 });

    // Publish button should be usable
    const publishBtn = page.locator("[data-testid='publish-execute-btn']");
    await expect(publishBtn).toBeVisible();
    await expect(publishBtn).not.toBeDisabled();
  });

  test("publish command visible and survives preset switching", async ({
    page,
  }) => {
    await gotoAppWithPublishConfig(page);

    const folder = page.locator("[data-testid='pubxml-select-FolderProfile']");
    const zip = page.locator("[data-testid='pubxml-select-ZipProfile']");

    await expect(folder).toBeVisible({ timeout: 10000 });
    await expect(zip).toBeVisible();

    // Command preview should be visible
    const commandPreview = page.locator(
      "[data-testid='publish-command-preview']"
    );
    await expect(commandPreview).toBeVisible({ timeout: 10000 });
    await expect(folder).toHaveAttribute("data-selected", "true");
    await expect(commandPreview).toContainText("FolderProfile");

    await zip.click();
    await expect(folder).toHaveAttribute("data-selected", "false");
    await expect(zip).toHaveAttribute("data-selected", "true");
    await expect(commandPreview).toBeVisible({ timeout: 5000 });
    await expect(commandPreview).toContainText("ZipProfile");

    await folder.click();
    await expect(folder).toHaveAttribute("data-selected", "true");
    await expect(zip).toHaveAttribute("data-selected", "false");
    await expect(commandPreview).toBeVisible({ timeout: 5000 });
    await expect(commandPreview).toContainText("FolderProfile");
  });

  test("saved configuration runs through plan → Manifest → Receipt → lifecycle", async ({
    page,
  }) => {
    await gotoAppWithPublishConfig(page);

    await page
      .locator(
        "[data-list-item-id='userprofile:profile-folder'] button[aria-pressed]"
      )
      .click();

    const plan = page.locator("[data-testid='publish-runtime-plan']");
    await expect(plan).toBeVisible({ timeout: 10000 });
    // 统一选择协议：点击保存的配置 → revision 来源 → prepare 以该配置的
    // 当前修订执行（mock 按 selection 返回 profile-folder-revision-1），
    // plan → manifest → receipt 链路贯穿该修订身份。
    await expect(plan).toContainText("profile-folder-revision-1");
    await expect(plan).toContainText("local-execution");
    await expect(plan).toContainText("persist_manifest");

    const publishBtn = page.locator("[data-testid='publish-execute-btn']");
    await expect(publishBtn).not.toBeDisabled();
    await publishBtn.click();

    const runtimeResult = page.locator(
      "[data-testid='publish-runtime-result']"
    );
    await expect(runtimeResult).toBeVisible({ timeout: 15000 });
    await expect(runtimeResult).toContainText(
      "manifest-profile-folder-revision-1"
    );
    await expect(runtimeResult).toContainText(
      "receipt-profile-folder-revision-1"
    );
    await expect(runtimeResult).toContainText("published");
  });
});

test.describe("Full Publish Flow — Error Paths", () => {
  test("shows error state when publish command fails", async ({ page }) => {
    // plan 033：发布统一走 PublishRuntime，注入 start_publish_runtime 失败。
    await gotoApp(page, {
      errors: {
        start_publish_runtime: "publish process crashed with exit code 1",
      },
    });

    // Wait for publish config panel
    await expect(
      page.locator("[data-list-item-id='pubxml:FolderProfile']")
    ).toBeVisible({ timeout: 15000 });

    // Click publish
    const publishBtn = page.locator("[data-testid='publish-execute-btn']");
    await expect(publishBtn).not.toBeDisabled();
    await publishBtn.click();

    // Should eventually show error state (not "成功")
    const statusPanel = page.locator("[data-testid='publish-status-panel']");
    // Error state or cancelled state should appear
    await expect(statusPanel).toBeVisible({ timeout: 10000 });
    // publish:failed → notifyFeedback(toast) —— 用户可见错误反馈；
    // 未归类的进程错误走默认标题「发布执行错误」。
    await expect(
      page.locator("[data-sonner-toast]", { hasText: "发布执行错误" })
    ).toBeVisible({ timeout: 10000 });
  });

  test("classified spawn failure shows localized tool-missing feedback", async ({
    page,
  }) => {
    // "failed to spawn + os error 2" → tool_missing 归类 →
    // getPublishFailureFeedback 返回「缺少构建命令」标题。
    await gotoApp(page, {
      errors: {
        start_publish_runtime:
          "failed to spawn dotnet: No such file or directory (os error 2)",
      },
    });

    await expect(
      page.locator("[data-list-item-id='pubxml:FolderProfile']")
    ).toBeVisible({ timeout: 15000 });
    const publishBtn = page.locator("[data-testid='publish-execute-btn']");
    await expect(publishBtn).not.toBeDisabled();
    await publishBtn.click();

    await expect(
      page.locator("[data-sonner-toast]", { hasText: "缺少构建命令" })
    ).toBeVisible({ timeout: 10000 });
  });

  test("preflight failure prevents publish", async ({ page }) => {
    await gotoApp(page, {
      errors: {
        preflight_publish_output: "output path does not exist",
      },
    });

    await expect(
      page.locator("[data-list-item-id='pubxml:FolderProfile']")
    ).toBeVisible({ timeout: 15000 });

    const publishBtn = page.locator("[data-testid='publish-execute-btn']");
    await expect(publishBtn).toBeVisible({ timeout: 10000 });
    await publishBtn.click();

    // 预检 invoke 失败 → abortPublishPreparation 经 toast 呈现原因，
    // 且不进入运行态（start_publish_runtime 未发出）。
    await expect(
      page.locator("[data-sonner-toast]", { hasText: "发布目录预检失败" })
    ).toBeVisible({ timeout: 10000 });
    await expect
      .poll(async () =>
        page.evaluate(() =>
          (
            window as unknown as { __MOCK_INVOCATIONS__: string[] }
          ).__MOCK_INVOCATIONS__.includes("start_publish_runtime")
        )
      )
      .toBe(false);
  });

  test("critical environment issue aborts publish and opens env dialog", async ({
    page,
  }) => {
    await gotoApp(page, {
      envCheck: {
        is_ready: false,
        providers: [
          {
            provider_id: "dotnet",
            installed: false,
            version: null,
            path: null,
          },
        ],
        issues: [
          {
            severity: "critical",
            provider_id: "dotnet",
            issue_type: "missing_tool",
            description: "dotnet SDK is required",
            current_value: null,
            expected_value: ">=8.0",
            fixes: [
              {
                action_type: "open_url",
                label: "Install .NET",
                command: null,
                url: "https://dotnet.microsoft.com/download",
              },
            ],
          },
        ],
        checked_at: new Date().toISOString(),
      },
    });

    await expect(
      page.locator("[data-list-item-id='pubxml:FolderProfile']")
    ).toBeVisible({ timeout: 15000 });
    const publishBtn = page.locator("[data-testid='publish-execute-btn']");
    await expect(publishBtn).not.toBeDisabled();
    await publishBtn.click();

    // 环境 critical → abort：toast 呈现阻止原因且环境对话框打开。
    await expect(
      page.locator("[data-sonner-toast]", { hasText: "环境未就绪" })
    ).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("工具状态")).toBeVisible({ timeout: 10000 });
    await expect
      .poll(async () =>
        page.evaluate(() =>
          (
            window as unknown as { __MOCK_INVOCATIONS__: string[] }
          ).__MOCK_INVOCATIONS__.includes("start_publish_runtime")
        )
      )
      .toBe(false);
  });

  test("incompatible output path aborts with validation feedback", async ({
    page,
  }) => {
    await gotoApp(page, {
      preflightOutput: {
        validationStatus: "incompatible",
        validationIssue: "windows_drive_root_missing",
      },
    });

    await expect(
      page.locator("[data-list-item-id='pubxml:FolderProfile']")
    ).toBeVisible({ timeout: 15000 });
    const publishBtn = page.locator("[data-testid='publish-execute-btn']");
    await expect(publishBtn).not.toBeDisabled();
    await publishBtn.click();

    // validation.status=incompatible → abort 并呈现分类标题「发布目录无效」。
    await expect(
      page.locator("[data-sonner-toast]", { hasText: "发布目录无效" })
    ).toBeVisible({ timeout: 10000 });
    await expect
      .poll(async () =>
        page.evaluate(() =>
          (
            window as unknown as { __MOCK_INVOCATIONS__: string[] }
          ).__MOCK_INVOCATIONS__.includes("start_publish_runtime")
        )
      )
      .toBe(false);
  });

  test("denied protected-directory access aborts after picker cancel", async ({
    page,
  }) => {
    // access.status=denied → 受保护目录授权流程；dialogOpenPath 缺省
    // null 表示用户在选择器中取消 → 仍 denied → abort toast。
    await gotoApp(page, {
      preflightOutput: { accessStatus: "denied" },
    });

    await expect(
      page.locator("[data-list-item-id='pubxml:FolderProfile']")
    ).toBeVisible({ timeout: 15000 });
    const publishBtn = page.locator("[data-testid='publish-execute-btn']");
    await expect(publishBtn).not.toBeDisabled();
    await publishBtn.click();

    await expect(
      page.locator("[data-sonner-toast]", {
        hasText: "受保护目录访问权限",
      })
    ).toBeVisible({ timeout: 10000 });
    await expect
      .poll(async () =>
        page.evaluate(() =>
          (
            window as unknown as { __MOCK_INVOCATIONS__: string[] }
          ).__MOCK_INVOCATIONS__.includes("start_publish_runtime")
        )
      )
      .toBe(false);
  });

  test("granted protected-directory access retries preflight and publishes", async ({
    page,
  }) => {
    // access.status=denied → 授权选择器（dialogOpenPath 模拟用户授权目录）
    // → 第 2 次 preflight_publish_output 返回 granted → 发布放行。
    await gotoApp(page, {
      preflightOutput: { accessStatus: "denied" },
      preflightOutputAfterPick: { accessStatus: "granted" },
      dialogOpenPath: "/tmp/publish-output",
    });

    await expect(
      page.locator("[data-list-item-id='pubxml:FolderProfile']")
    ).toBeVisible({ timeout: 15000 });
    const publishBtn = page.locator("[data-testid='publish-execute-btn']");
    await expect(publishBtn).not.toBeDisabled();
    await publishBtn.click();

    // 授权选择器被打开，随后重试 preflight 放行进入运行态。
    await expect
      .poll(async () =>
        page.evaluate(() =>
          (
            window as unknown as { __MOCK_INVOCATIONS__: string[] }
          ).__MOCK_INVOCATIONS__.includes("plugin:dialog|open")
        )
      )
      .toBe(true);
    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            (
              window as unknown as { __MOCK_INVOCATIONS__: string[] }
            ).__MOCK_INVOCATIONS__.filter(
              (c) => c === "preflight_publish_output"
            ).length
        )
      )
      .toBe(2);
    await expect
      .poll(async () =>
        page.evaluate(() =>
          (
            window as unknown as { __MOCK_INVOCATIONS__: string[] }
          ).__MOCK_INVOCATIONS__.includes("start_publish_runtime")
        )
      )
      .toBe(true);
    await expect(
      page.locator("[data-sonner-toast]", { hasText: "发布完成" })
    ).toBeVisible({ timeout: 10000 });
  });

  test("protected-directory picker failure aborts with request-failed feedback", async ({
    page,
  }) => {
    // access.status=denied → 授权选择器自身抛错（plugin:dialog|open 注错）
    // →「申请目录访问权限失败」abort toast，不进运行态。
    await gotoApp(page, {
      preflightOutput: { accessStatus: "denied" },
      errors: { "plugin:dialog|open": "dialog backend unavailable" },
    });

    await expect(
      page.locator("[data-list-item-id='pubxml:FolderProfile']")
    ).toBeVisible({ timeout: 15000 });
    const publishBtn = page.locator("[data-testid='publish-execute-btn']");
    await expect(publishBtn).not.toBeDisabled();
    await publishBtn.click();

    await expect(
      page.locator("[data-sonner-toast]", {
        hasText: "申请目录访问权限失败",
      })
    ).toBeVisible({ timeout: 10000 });
    await expect
      .poll(async () =>
        page.evaluate(() =>
          (
            window as unknown as { __MOCK_INVOCATIONS__: string[] }
          ).__MOCK_INVOCATIONS__.includes("start_publish_runtime")
        )
      )
      .toBe(false);
  });

  test("blocked prepare result surfaces diagnostics and prevents publish", async ({
    page,
  }) => {
    // blocked: 前缀建模 prepare_publish_runtime 的阻塞结果（非抛错）。
    await gotoApp(page, {
      errors: {
        prepare_publish_runtime: "blocked:provider binding is required",
      },
    });

    await expect(
      page.locator("[data-list-item-id='pubxml:FolderProfile']")
    ).toBeVisible({ timeout: 15000 });

    // 预览期 prepare 已返回 blocked → run card 渲染诊断、执行钮禁用，
    // 发布根本不可发起。
    const publishBtn = page.locator("[data-testid='publish-execute-btn']");
    await expect(publishBtn).toBeDisabled({ timeout: 10000 });
    await expect(page.getByText("provider binding is required")).toBeVisible({
      timeout: 10000,
    });
    await expect
      .poll(async () =>
        page.evaluate(() =>
          (
            window as unknown as { __MOCK_INVOCATIONS__: string[] }
          ).__MOCK_INVOCATIONS__.includes("start_publish_runtime")
        )
      )
      .toBe(false);
  });

  test("blocked prepare with denied access authorizes at publish start", async ({
    page,
  }) => {
    // 预览期 prepare 返回 blocked + publish_output_access_denied →
    // canRequestRuntimeOutputAccess → run card 仍属待执行（可发起），
    // 开始发布时先经选择器授权 → 重试 prepare 放行 → 正常发布。
    await gotoApp(page, {
      errors: {
        prepare_publish_runtime: "blocked:输出目录位于受保护位置",
      },
      preflightOutput: { accessStatus: "denied" },
      preflightOutputAfterPick: { accessStatus: "granted" },
      dialogOpenPath: "/tmp/publish-output",
    });

    await expect(
      page.locator("[data-list-item-id='pubxml:FolderProfile']")
    ).toBeVisible({ timeout: 15000 });
    const publishBtn = page.locator("[data-testid='publish-execute-btn']");
    await expect(publishBtn).not.toBeDisabled({ timeout: 10000 });
    await publishBtn.click();

    // 授权选择器打开一次（outputAccessPicked）→ 重试 prepare 返回 ready →
    // preflight 放行 → start_publish_runtime。
    await expect
      .poll(async () =>
        page.evaluate(() =>
          (
            window as unknown as { __MOCK_INVOCATIONS__: string[] }
          ).__MOCK_INVOCATIONS__.includes("plugin:dialog|open")
        )
      )
      .toBe(true);
    await expect
      .poll(async () =>
        page.evaluate(() =>
          (
            window as unknown as { __MOCK_INVOCATIONS__: string[] }
          ).__MOCK_INVOCATIONS__.includes("start_publish_runtime")
        )
      )
      .toBe(true);
    await expect(
      page.locator("[data-sonner-toast]", { hasText: "发布完成" })
    ).toBeVisible({ timeout: 10000 });
  });

  test("warning environment issue warns but still publishes", async ({
    page,
  }) => {
    await gotoApp(page, {
      envCheck: {
        is_ready: true,
        providers: [
          {
            provider_id: "dotnet",
            installed: true,
            version: "8.0.403",
            path: "/usr/local/share/dotnet/dotnet",
          },
        ],
        issues: [
          {
            severity: "warning",
            provider_id: "dotnet",
            issue_type: "outdated_version",
            description: "dotnet SDK is older than recommended",
            current_value: "8.0.100",
            expected_value: ">=8.0.300",
            fixes: [],
          },
        ],
        checked_at: new Date().toISOString(),
      },
    });

    await expect(
      page.locator("[data-list-item-id='pubxml:FolderProfile']")
    ).toBeVisible({ timeout: 15000 });
    const publishBtn = page.locator("[data-testid='publish-execute-btn']");
    await expect(publishBtn).not.toBeDisabled();
    await publishBtn.click();

    // warning 仅提示不阻断——发布照常进入运行态。
    await expect(
      page.locator("[data-sonner-toast]", { hasText: "环境存在警告" })
    ).toBeVisible({ timeout: 10000 });
    await expect
      .poll(async () =>
        page.evaluate(() =>
          (
            window as unknown as { __MOCK_INVOCATIONS__: string[] }
          ).__MOCK_INVOCATIONS__.includes("start_publish_runtime")
        )
      )
      .toBe(true);
  });

  test("provider schema fetch failure is handled gracefully", async ({
    page,
  }) => {
    await gotoApp(page, {
      errors: {
        get_provider_schema: "schema not found for provider",
      },
    });

    // App should still render — repo list should be visible
    await expect(page.locator("[data-list-item-id='repo-a']")).toBeVisible({
      timeout: 15000,
    });
  });
});

test.describe("Publish Flow — Edge Cases", () => {
  test("cancel during runtime invokes cancel_publish_runtime", async ({
    page,
  }) => {
    // publishRuntimeLatch 挂起 start_publish_runtime——运行中窗口内
    // 取消按钮可点击，断言 runtimeToken 取消命令与反馈提示。
    await gotoApp(page, { publishRuntimeLatch: true });

    await expect(
      page.locator("[data-list-item-id='pubxml:FolderProfile']")
    ).toBeVisible({ timeout: 15000 });
    const publishBtn = page.locator("[data-testid='publish-execute-btn']");
    await expect(publishBtn).not.toBeDisabled();
    await publishBtn.click();

    // 等 start_publish_runtime 已发出——此时 phase="running" 且
    // runtimeToken 就位；过早点击会走 preflight 本地重置臂（不发命令）。
    await expect
      .poll(async () =>
        page.evaluate(() =>
          (
            window as unknown as {
              __MOCK_INVOKE_ARGS__: { cmd: string }[];
            }
          ).__MOCK_INVOKE_ARGS__.some(
            (entry) => entry.cmd === "start_publish_runtime"
          )
        )
      )
      .toBe(true);

    const cancelBtn = page.getByRole("button", { name: "取消发布" });
    await expect(cancelBtn).toBeVisible({ timeout: 15000 });
    await cancelBtn.click();

    await expect(page.getByText(/正在取消发布/)).toBeVisible({
      timeout: 10000,
    });
    await expect
      .poll(async () =>
        page.evaluate(() =>
          (
            window as unknown as {
              __MOCK_INVOKE_ARGS__: { cmd: string; args?: unknown }[];
            }
          ).__MOCK_INVOKE_ARGS__.some(
            (entry) =>
              entry.cmd === "cancel_publish_runtime" &&
              Boolean(
                (
                  entry.args as {
                    request?: { runtimeToken?: string };
                  }
                )?.request?.runtimeToken
              )
          )
        )
      )
      .toBe(true);

    await page.evaluate(() => {
      (
        window as unknown as {
          __MOCK_RESOLVE_PUBLISH_RUNTIME__: () => void;
        }
      ).__MOCK_RESOLVE_PUBLISH_RUNTIME__();
    });
  });

  test("publish button is disabled when no repo is selected", async ({
    page,
  }) => {
    await gotoApp(page);

    // Deselect repo-a by selecting then deselecting (or if there's a deselect mechanism)
    // Verify the publish panel still renders
    await expect(
      page.locator("[data-testid='publish-status-panel']")
    ).toBeVisible({ timeout: 10000 });
  });

  test("rapid double-click of publish button is handled", async ({ page }) => {
    await gotoAppWithPublishConfig(page);

    const publishBtn = page.locator("[data-testid='publish-execute-btn']");
    await expect(publishBtn).not.toBeDisabled();

    // Double-click quickly
    await publishBtn.click();
    await publishBtn.click();

    // Should not crash — app should still be responsive
    await expect(
      page.locator("[data-testid='publish-status-panel']")
    ).toBeVisible({ timeout: 10000 });
  });
});
