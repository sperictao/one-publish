/**
 * 16-favorite-configs — 收藏配置的 e2e 准绳：
 * 自定义 profile 行的操作菜单提供「收藏配置/取消收藏」开关；收藏状态
 * 经 localStorage 持久化，页面重载后仍生效。无 Tauri 命令参与——
 * 纯前端状态，本条同时钉住菜单项文案翻转与跨重载持久性。
 */
import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "../fixtures/mock-tauri";

const ZIP_ROW = "[data-list-item-id='userprofile:profile-zip']";
const MORE_ACTIONS_ZIP = "更多操作: ZipProfile";

async function openRowMenu(page: Page) {
  // 触发器常态 opacity-0，group-hover 才显现；点击不依赖可见性。
  // 项目 profile 与自定义 profile 可能同名，菜单按钮限定在行内。
  const row = page.locator(ZIP_ROW);
  await row.hover();
  await row.getByRole("button", { name: MORE_ACTIONS_ZIP }).click();
}

test.describe("Favorite configs", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await expect(page.locator(ZIP_ROW)).toBeVisible({ timeout: 10000 });
  });

  test("收藏后菜单项翻转为取消收藏，并在重载后保持", async ({ page }) => {
    await openRowMenu(page);
    await page.getByRole("menuitem", { name: "收藏配置" }).click();

    await openRowMenu(page);
    await expect(
      page.getByRole("menuitem", { name: "取消收藏" })
    ).toBeVisible();
    await page.keyboard.press("Escape");

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(ZIP_ROW)).toBeVisible({ timeout: 10000 });
    await openRowMenu(page);
    await expect(
      page.getByRole("menuitem", { name: "取消收藏" })
    ).toBeVisible();
  });

  test("取消收藏恢复收藏配置入口", async ({ page }) => {
    await openRowMenu(page);
    await page.getByRole("menuitem", { name: "收藏配置" }).click();

    await openRowMenu(page);
    await page.getByRole("menuitem", { name: "取消收藏" }).click();

    await openRowMenu(page);
    await expect(
      page.getByRole("menuitem", { name: "收藏配置" })
    ).toBeVisible();
  });
});
