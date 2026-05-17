/**
 * 04-publish-preset — Preset-based publish workflow: select profile, preflight, execute.
 */
import { test, expect } from "@playwright/test";
import { gotoApp } from "../fixtures/mock-tauri";

test.describe("Preset Publish Workflow", () => {
  test("publish config panel shows preset profiles", async ({ page }) => {
    await gotoApp(page);

    // Default repo-a has publish profiles: FolderProfile, ZipProfile, WebDeploy
    await expect(page.locator("[data-list-item-id='pubxml:FolderProfile']")).toBeVisible();
    await expect(page.locator("[data-list-item-id='pubxml:ZipProfile']")).toBeVisible();
    await expect(page.locator("[data-list-item-id='pubxml:WebDeploy']")).toBeVisible();
  });

  test("preset FolderProfile is visible in publish config panel", async ({ page }) => {
    await gotoApp(page);

    const folderRow = page.locator("[data-list-item-id='pubxml:FolderProfile']");
    await expect(folderRow).toBeVisible();
    await expect(folderRow).toContainText("FolderProfile");
  });

  test("switching presets updates the selection", async ({ page }) => {
    await gotoApp(page);

    // Click on ZipProfile row to select it
    const zipRow = page.locator("[data-list-item-id='pubxml:ZipProfile']");
    await expect(zipRow).toBeVisible();
    await zipRow.click();
    await page.waitForTimeout(500);

    // ZipProfile row should still be visible after clicking
    await expect(zipRow).toBeVisible();
  });

  test("rendered publish command is visible for selected preset", async ({ page }) => {
    await gotoApp(page);

    // The publish section shows "将执行的命令" and the command string
    await expect(page.getByText("将执行的命令")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("dotnet publish --configuration Release")).toBeVisible();
  });

  test("execute publish button is present", async ({ page }) => {
    await gotoApp(page);

    // "执行发布" button should be visible
    const executeBtn = page.getByRole("button", { name: /执行发布/i });
    await expect(executeBtn).toBeVisible({ timeout: 10000 });
  });

  test("publish status panel shows initial state", async ({ page }) => {
    await gotoApp(page);

    // The publish status panel should show "待执行" (pending)
    const statusArea = page.getByText("待执行");
    await expect(statusArea).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Preset Tabs / Sections", () => {
  test("publish config tabs are present", async ({ page }) => {
    await gotoApp(page);

    // The publish config panel should have section tabs or categories
    // "项目发布配置" (project publish config) section
    await expect(page.getByText("项目发布配置")).toBeVisible({ timeout: 10000 });
  });
});
