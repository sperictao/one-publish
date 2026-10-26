/**
 * 13-config-import-conflict — Phase 11 候选 A 的 e2e 准绳：
 * 同名导入冲突时 UI 提供三选一（跳过/覆盖/重命名），覆盖策略下确认按钮
 * 可用且结果按策略计数反馈；导入流程后发布命令（dry-run preflight）仍可用。
 */
import { test, expect } from "@playwright/test";
import { gotoApp } from "../fixtures/mock-tauri";

test.describe("Config import conflict strategy (Phase 11 candidate A)", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page, { dialogOpenPath: "/tmp/one-publish-config.json" });
    await page.getByRole("button", { name: /配置管理/i }).click();
    await page.getByRole("button", { name: "导入配置" }).click();
    // mock 的 import_config 返回与 repo-a 现有 FolderProfile 同名的导入项。
    await expect(page.getByText("同名已存在，跳过")).toBeVisible({
      timeout: 10000,
    });
  });

  test("同名冲突显示三选一，默认跳过时确认不可用", async ({ page }) => {
    const strategyGroup = page.getByRole("radiogroup");
    await expect(strategyGroup).toBeVisible();
    await expect(
      strategyGroup.getByRole("radio", { name: /跳过/ })
    ).toHaveAttribute("aria-checked", "true");

    // 默认 skip：无可导入项，确认按钮禁用。
    await expect(
      page.getByRole("button", { name: "导入配置", exact: true })
    ).toBeDisabled();
  });

  test("覆盖策略下确认可用，结果按覆盖计数反馈", async ({ page }) => {
    const overwriteRadio = page
      .getByRole("radiogroup")
      .getByRole("radio", { name: /覆盖/ });
    await overwriteRadio.click();
    await expect(overwriteRadio).toHaveAttribute("aria-checked", "true");

    const confirm = page.getByRole("button", { name: "导入配置", exact: true });
    await expect(confirm).toBeEnabled();
    await confirm.click();

    const toast = page.locator("[data-sonner-toast]");
    await expect(toast).toBeVisible({ timeout: 10000 });
    await expect(toast).toContainText("配置已导入");
    await expect(toast).toContainText("同名覆盖：1");
  });

  test("重命名策略按派生名计数反馈", async ({ page }) => {
    await page
      .getByRole("radiogroup")
      .getByRole("radio", { name: /重命名/ })
      .click();
    await page.getByRole("button", { name: "导入配置", exact: true }).click();

    const toast = page.locator("[data-sonner-toast]");
    await expect(toast).toBeVisible({ timeout: 10000 });
    await expect(toast).toContainText("配置已导入");
    await expect(toast).toContainText("重命名导入：1");
  });

  test("导入流程结束后发布命令（dry-run）仍可用", async ({ page }) => {
    await page
      .getByRole("radiogroup")
      .getByRole("radio", { name: /覆盖/ })
      .click();
    await page.getByRole("button", { name: "导入配置", exact: true }).click();
    const toast = page.locator("[data-sonner-toast]");
    await expect(toast).toBeVisible({ timeout: 10000 });
    await expect(toast).toContainText("同名覆盖：1");

    await page.keyboard.press("Escape");
    // 导入后回到主界面：命令预览（preflight 的 dry-run 呈现）仍渲染。
    await expect(page.locator("text=将执行的命令")).toBeVisible({
      timeout: 15000,
    });
  });
});
