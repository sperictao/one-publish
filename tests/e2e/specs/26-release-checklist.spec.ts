/**
 * 26-release-checklist — 发布清单对话框与预检报告导出。
 *
 * 覆盖发布成功后的收尾面：「发布清单」入口 → 签名发布清单对话框
 * 步骤导航 → 「导出预检报告」经 plugin:dialog|save 选路径 →
 * export_preflight_report 落盘 → 成功反馈。
 */
import { test, expect } from "@playwright/test";
import { gotoAppWithPublishConfig } from "../fixtures/mock-tauri";

test.describe("Release checklist", () => {
  test("publish success opens checklist and exports preflight report", async ({
    page,
  }) => {
    await gotoAppWithPublishConfig(page, {
      dialogSavePath: "/tmp/preflight-report.md",
    });

    // 走完一次发布 → 成功态出现「发布清单」入口；同时断言每次发布
    // 收尾都会为执行记录导出快照（export_execution_snapshot）。
    const publishBtn = page.locator("[data-testid='publish-execute-btn']");
    await expect(publishBtn).not.toBeDisabled();
    await publishBtn.click();
    await expect(
      page.locator("[data-testid='publish-status-panel']")
    ).toContainText("成功", { timeout: 15000 });
    await expect
      .poll(async () =>
        page.evaluate(() =>
          (
            window as unknown as { __MOCK_INVOCATIONS__: string[] }
          ).__MOCK_INVOCATIONS__.includes("export_execution_snapshot")
        )
      )
      .toBe(true);

    await page.getByRole("button", { name: "发布清单" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10000 });
    await expect(dialog).toContainText("签名发布清单");

    // 步骤导航：下一步 → 上一步回到首步。
    await dialog.getByRole("button", { name: "下一步" }).click();
    await dialog.getByRole("button", { name: "上一步" }).click();

    // 导出：dialog|save 返回种子路径 → export_preflight_report 以
    // 所选 filePath 落盘。
    await dialog.getByRole("button", { name: "导出预检报告" }).click();
    await expect
      .poll(async () =>
        page.evaluate(() =>
          (
            window as unknown as {
              __MOCK_INVOKE_ARGS__: Record<string, unknown>[];
            }
          ).__MOCK_INVOKE_ARGS__.some(
            (entry) =>
              (entry as { cmd?: string }).cmd === "export_preflight_report" &&
              ((entry as { args?: { filePath?: string } }).args?.filePath ??
                "") === "/tmp/preflight-report.md"
          )
        )
      )
      .toBe(true);
    await expect(
      page.locator("[data-sonner-toast]", { hasText: "预检报告已导出" })
    ).toBeVisible({ timeout: 10000 });
  });

  test("package → sign artifact chain after publish success", async ({
    page,
  }) => {
    await gotoAppWithPublishConfig(page, {
      dialogSavePath: "/tmp/artifact.zip",
    });

    const publishBtn = page.locator("[data-testid='publish-execute-btn']");
    await expect(publishBtn).not.toBeDisabled();
    await publishBtn.click();
    await expect(
      page.locator("[data-testid='publish-status-panel']")
    ).toContainText("成功", { timeout: 15000 });

    // 打包：dialog|save 返回种子路径 → package_artifact → 成功反馈。
    await page.getByRole("button", { name: "打包 ZIP" }).click();
    await expect
      .poll(async () =>
        page.evaluate(() =>
          (
            window as unknown as { __MOCK_INVOCATIONS__: string[] }
          ).__MOCK_INVOCATIONS__.includes("package_artifact")
        )
      )
      .toBe(true);
    await expect(
      page.locator("[data-sonner-toast]", { hasText: "打包完成" })
    ).toBeVisible({ timeout: 10000 });

    // 打包成功后签名按钮可用 → sign_artifact → 成功反馈。
    const signBtn = page.getByRole("button", { name: "签名" });
    await expect(signBtn).not.toBeDisabled({ timeout: 10000 });
    await signBtn.click();
    await expect
      .poll(async () =>
        page.evaluate(() =>
          (
            window as unknown as { __MOCK_INVOCATIONS__: string[] }
          ).__MOCK_INVOCATIONS__.includes("sign_artifact")
        )
      )
      .toBe(true);
    await expect(
      page.locator("[data-sonner-toast]", { hasText: "签名完成" })
    ).toBeVisible({ timeout: 10000 });
  });

  test("package picker cancel skips packaging silently", async ({ page }) => {
    await gotoAppWithPublishConfig(page);

    const publishBtn = page.locator("[data-testid='publish-execute-btn']");
    await expect(publishBtn).not.toBeDisabled();
    await publishBtn.click();
    await expect(
      page.locator("[data-testid='publish-status-panel']")
    ).toContainText("成功", { timeout: 15000 });

    // dialogSavePath 缺省 null → 保存框取消 → 不发 package_artifact，
    // 签名按钮保持不可用。
    await page.getByRole("button", { name: "打包 ZIP" }).click();
    await expect
      .poll(async () =>
        page.evaluate(() =>
          (
            window as unknown as { __MOCK_INVOCATIONS__: string[] }
          ).__MOCK_INVOCATIONS__.includes("package_artifact")
        )
      )
      .toBe(false);
    await expect(page.getByRole("button", { name: "签名" })).toBeDisabled();
  });

  test("export cancel leaves dialog open without export", async ({ page }) => {
    await gotoAppWithPublishConfig(page);

    const publishBtn = page.locator("[data-testid='publish-execute-btn']");
    await expect(publishBtn).not.toBeDisabled();
    await publishBtn.click();
    await expect(
      page.locator("[data-testid='publish-status-panel']")
    ).toContainText("成功", { timeout: 15000 });

    await page.getByRole("button", { name: "发布清单" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // dialogSavePath 缺省 null → 用户在保存框取消 → 不发导出命令。
    await dialog.getByRole("button", { name: "导出预检报告" }).click();
    await expect(dialog).toBeVisible();
    await expect
      .poll(async () =>
        page.evaluate(() =>
          (
            window as unknown as { __MOCK_INVOCATIONS__: string[] }
          ).__MOCK_INVOCATIONS__.includes("export_preflight_report")
        )
      )
      .toBe(false);
  });
});
