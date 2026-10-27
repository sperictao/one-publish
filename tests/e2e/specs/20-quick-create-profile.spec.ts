/**
 * 20-quick-create-profile — 快速创建发布配置的 e2e 准绳：
 * 新建按钮打开对话框；空名/纯空白名时保存按钮禁用；填名保存经
 * save_profile 写入后端、前端按名回读新配置身份并提示成功，
 * 新行出现在配置列表。
 * mock 的 save_profile 与真后端对齐：向仓库追加 profile 并返回 AppState。
 */
import { test, expect } from "@playwright/test";
import { gotoApp } from "../fixtures/mock-tauri";

const NEW_ROW = "[data-list-item-id='userprofile:profile-E2ECfg']";

test.describe("Quick create profile", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId("new-config-btn").click();
    await expect(
      page.getByRole("dialog", { name: "创建发布配置" })
    ).toBeVisible({ timeout: 10000 });
  });

  test("空名时保存按钮禁用", async ({ page }) => {
    await expect(
      page.getByRole("button", { name: "创建并保存" })
    ).toBeDisabled();
    await page.getByPlaceholder("输入配置文件名称").fill(" ");
    await expect(
      page.getByRole("button", { name: "创建并保存" })
    ).toBeDisabled();
  });

  test("填名保存创建配置并出现在列表", async ({ page }) => {
    await page.getByPlaceholder("输入配置文件名称").fill("E2ECfg");
    await page.getByRole("button", { name: "创建并保存" }).click();

    await expect(
      page.locator("[data-sonner-toast]", { hasText: "配置已保存" })
    ).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("dialog", { name: "创建发布配置" })).toBeHidden(
      { timeout: 10000 }
    );
    await expect(page.locator(NEW_ROW)).toBeVisible({ timeout: 10000 });
  });
});
