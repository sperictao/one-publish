/**
 * 17-settings-dialog — 设置对话框的 e2e 准绳：
 * 打开设置 → 主题卡片切换立即作用于 documentElement；语言切换即时更新
 * 界面文案。两项偏好经 update_preferences 落库（mock 后端 get_app_state
 * 可读回）——持久化断言在导航前完成，因为 init-script mock 的状态不跨
 * 页面重载存活。
 */
import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "../fixtures/mock-tauri";

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "打开设置" }).click();
  await expect(page.getByRole("dialog", { name: "应用设置" })).toBeVisible({
    timeout: 10000,
  });
}

function appState(page: Page) {
  return page.evaluate(
    () =>
      window.__TAURI_INTERNALS__.invoke("get_app_state") as Promise<{
        theme?: string;
        language?: string;
      }>
  );
}

test.describe("Settings dialog", () => {
  test("主题切换即时应用并持久化到偏好", async ({ page }) => {
    await gotoApp(page);
    await openSettings(page);
    await page.getByRole("button", { name: "外观" }).click();

    await page.getByRole("button", { name: /暗色/ }).click();
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.classList.contains("dark"))
      )
      .toBe(true);

    // 偏好持久化有 ~500ms 防抖；轮询至后端可读回。
    await expect.poll(async () => (await appState(page)).theme).toBe("dark");
  });

  test("语言切换即时更新界面并持久化到偏好", async ({ page }) => {
    await gotoApp(page);
    await openSettings(page);

    await page.locator("#settings-language").click();
    await page.getByRole("option", { name: "English" }).click();

    await expect(page.getByText("Interface Language")).toBeVisible({
      timeout: 10000,
    });
    await expect.poll(async () => (await appState(page)).language).toBe("en");
  });
});
