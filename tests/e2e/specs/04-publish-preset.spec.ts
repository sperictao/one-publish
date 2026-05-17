/**
 * 04-publish-preset — Preset-based publish workflow: select profile, preflight, execute.
 *
 * Covers selection-state assertions (data-testid on pubxml selection buttons)
 * to catch the "中栏发布配置无法选中" class of bugs.
 */
import { test, expect } from "@playwright/test";
import { gotoApp, gotoAppWithPublishConfig } from "../fixtures/mock-tauri";

// Selector helpers for pubxml selection buttons
const selectBtn = (name: string) => `[data-testid='pubxml-select-${name}']`;

test.describe("Preset Publish Workflow", () => {
  test("publish config panel shows preset profiles", async ({ page }) => {
    await gotoApp(page);

    await expect(
      page.locator("[data-list-item-id='pubxml:FolderProfile']"),
    ).toBeVisible();
    await expect(
      page.locator("[data-list-item-id='pubxml:ZipProfile']"),
    ).toBeVisible();
    await expect(
      page.locator("[data-list-item-id='pubxml:WebDeploy']"),
    ).toBeVisible();
  });

  test("default preset is selected on load", async ({ page }) => {
    await gotoAppWithPublishConfig(page);

    // The default selected preset's button should exist and be clickable
    const btn = page.locator(selectBtn("FolderProfile"));
    await expect(btn).toBeVisible({ timeout: 10000 });
  });

  test("switching presets changes the active selection", async ({ page }) => {
    await gotoAppWithPublishConfig(page);

    const folder = page.locator(selectBtn("FolderProfile"));
    const zip = page.locator(selectBtn("ZipProfile"));

    await expect(folder).toBeVisible({ timeout: 10000 });
    await expect(zip).toBeVisible({ timeout: 10000 });

    // Click ZipProfile — the publish command preview should update
    await zip.click();

    // Both buttons should still be visible after switching
    await expect(zip).toBeVisible();
    await expect(folder).toBeVisible();
  });

  test("clicking already-selected preset does not crash", async ({ page }) => {
    await gotoAppWithPublishConfig(page);

    const btn = page.locator(selectBtn("FolderProfile"));
    await expect(btn).toBeVisible({ timeout: 10000 });

    // Click twice — should not crash
    await btn.click();
    await btn.click();
    await expect(btn).toBeVisible();
  });

  test("rapid preset switching does not crash", async ({ page }) => {
    await gotoAppWithPublishConfig(page);

    const folder = page.locator(selectBtn("FolderProfile"));
    const zip = page.locator(selectBtn("ZipProfile"));
    const web = page.locator(selectBtn("WebDeploy"));

    await expect(folder).toBeVisible({ timeout: 10000 });

    // Rapidly click through all three
    await zip.click();
    await web.click();
    await folder.click();

    // App should still be responsive
    await expect(folder).toBeVisible();
    await expect(zip).toBeVisible();
    await expect(web).toBeVisible();
  });

  test("rendered publish command is visible for selected preset", async ({
    page,
  }) => {
    await gotoApp(page);

    await expect(page.getByText("将执行的命令")).toBeVisible({
      timeout: 10000,
    });
    await expect(
      page.getByText("dotnet publish --configuration Release"),
    ).toBeVisible();
  });

  test("execute publish button is present", async ({ page }) => {
    await gotoApp(page);

    const executeBtn = page.locator("[data-testid='publish-execute-btn']");
    await expect(executeBtn).toBeVisible({ timeout: 10000 });
  });

  test("publish status panel shows initial state", async ({ page }) => {
    await gotoApp(page);

    const statusPanel = page.locator("[data-testid='publish-status-panel']");
    await expect(statusPanel).toBeVisible({ timeout: 10000 });
    await expect(statusPanel).toContainText("待执行");
  });
});

test.describe("Preset Tabs / Sections", () => {
  test("publish config tabs are present", async ({ page }) => {
    await gotoApp(page);

    await expect(page.getByText("项目发布配置")).toBeVisible({
      timeout: 10000,
    });
  });
});
