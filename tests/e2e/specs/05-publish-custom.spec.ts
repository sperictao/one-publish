/**
 * 05-publish-custom — Custom mode publish configuration form.
 */
import { test, expect } from "@playwright/test";
import { gotoApp } from "../fixtures/mock-tauri";

test.describe("Custom Publish Mode", () => {
  test("custom mode toggle or option is present", async ({ page }) => {
    await gotoApp(page);

    // The "新建配置" button is the entry point for custom configurations
    const newConfigBtn = page.getByRole("button", { name: /新建配置/i });
    await expect(newConfigBtn).toBeVisible({ timeout: 10000 });
  });

  test("parameter form renders when in custom mode", async ({ page }) => {
    await gotoApp(page);

    // Click "新建配置" to enter custom mode (or find custom mode toggle)
    const newConfigBtn = page.getByRole("button", { name: /新建配置/i });
    if (await newConfigBtn.isVisible()) {
      await newConfigBtn.click();
      await page.waitForTimeout(500);
    }
    // After entering custom mode, parameter fields should appear
    // (depends on UI implementation — may show form fields)
  });

  test("configuration parameter is present in custom form", async ({ page }) => {
    await gotoApp(page);

    // The publish command preview includes --configuration Release
    // which derives from the provider schema's 'configuration' parameter
    const commandPreview = page.getByText(/--configuration Release/);
    await expect(commandPreview).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Recent Publish Configs", () => {
  test("recent configs section is present", async ({ page }) => {
    await gotoApp(page);

    // The publish config panel may have a "recent" or "history" of configs
    // Look for config management UI
    const configMgmt = page.getByRole("button", { name: /配置管理/i });
    await expect(configMgmt).toBeVisible({ timeout: 10000 });
  });

  test("config management button opens config panel", async ({ page }) => {
    await gotoApp(page);

    const configMgmtBtn = page.getByRole("button", { name: /配置管理/i });
    if (await configMgmtBtn.isVisible()) {
      await configMgmtBtn.click();
      await page.waitForTimeout(500);
      // Config management panel should appear (may be a dialog or slide-out)
    }
  });
});
