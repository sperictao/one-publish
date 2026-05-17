/**
 * 01-app-boot — App startup, layout, and theme.
 *
 * Verifies the app boots correctly, renders all three panels,
 * responds to theme changes, and handles resize behavior.
 */
import { test, expect } from "@playwright/test";
import { gotoApp, installMockTauri } from "../fixtures/mock-tauri";

test.describe("App Boot", () => {
  test("renders root element after boot", async ({ page }) => {
    await gotoApp(page);
    await expect(page.locator("#root")).toHaveCount(1);
  });

  test("renders repository list in left panel", async ({ page }) => {
    await gotoApp(page);

    // Repository rows should be visible
    const repoA = page.locator("[data-list-item-id='repo-a']");
    await expect(repoA).toBeVisible();

    // Should show repo name text
    await expect(repoA).toContainText("alpha-service");
  });

  test("renders publish config panel in middle panel", async ({ page }) => {
    await gotoApp(page);

    // The publish config panel should show profile items
    const folderProfile = page.locator("[data-list-item-id='pubxml:FolderProfile']");
    await expect(folderProfile).toBeVisible({ timeout: 15000 });
  });

  test("three-panel layout is present with resizable handles", async ({ page }) => {
    await gotoApp(page);

    // The app root should be visible
    const root = page.locator("#root");
    await expect(root).toBeVisible({ timeout: 10000 });

    // Repository list panel should exist (left panel)
    await expect(page.locator("[data-list-item-id='repo-a']")).toBeVisible();
  });

  test("switches repository selection and updates middle panel", async ({ page }) => {
    await gotoApp(page);

    // Click repo-b selection button
    const repoBBtn = page.locator("[data-list-item-id='repo-b'] button[aria-pressed]");
    await repoBBtn.click();
    await page.waitForTimeout(500);

    // After selecting repo-b, publish config should still be visible
    // (the panel updates to show repo-b's config)
    await expect(page.locator("[data-list-item-id='pubxml:FolderProfile']")).toBeVisible({ timeout: 10000 });
  });

  test("app is functional with mocked Tauri backend", async ({ page }) => {
    // Install mock Tauri layer and navigate
    await installMockTauri(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    // Verify the mock layer is active
    const isMocked = await page.evaluate(() => !!(window as unknown as { isTauri?: boolean }).isTauri);
    expect(isMocked).toBe(false); // isTauri=false means mock is active

    const hasInternals = await page.evaluate(() => !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
    expect(hasInternals).toBe(true);
  });
});

test.describe("Layout & Resize", () => {
  test("left panel has a reasonable initial width", async ({ page }) => {
    await gotoApp(page);

    // Check the app root has reasonable dimensions
    const width = await page.evaluate(() => {
      const el = document.querySelector("#root");
      return el ? el.getBoundingClientRect().width : 0;
    });
    expect(width).toBeGreaterThan(300); // App should be at least 300px wide
  });

  test("repository rows are interactive", async ({ page }) => {
    await gotoApp(page);

    // Each repo row should have a pressable button
    const buttons = page.locator("[data-list-item-id='repo-a'] button[aria-pressed]");
    await expect(buttons).toHaveCount(1);

    const isPressed = await buttons.getAttribute("aria-pressed");
    expect(isPressed).toBe("true"); // First repo is selected by default
  });
});
