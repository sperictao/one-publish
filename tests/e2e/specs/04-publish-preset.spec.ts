/**
 * 04-publish-preset — Preset-based publish workflow: select profile, preflight, execute.
 *
 * Selection-state assertions use data-selected on pubxml buttons.
 */
import { test, expect, type Page } from "@playwright/test";
import { gotoApp, gotoAppWithPublishConfig } from "../fixtures/mock-tauri";

const selectBtn = (name: string) => `[data-testid='pubxml-select-${name}']`;

async function expectSelected(page: Page, name: string) {
  await expect(page.locator(selectBtn(name))).toHaveAttribute(
    "data-selected",
    "true",
  );
}

async function expectNotSelected(page: Page, name: string) {
  await expect(page.locator(selectBtn(name))).toHaveAttribute(
    "data-selected",
    "false",
  );
}

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

  test("default project profile is selected on load", async ({ page }) => {
    await gotoAppWithPublishConfig(page);

    await expectSelected(page, "FolderProfile");
    await expectNotSelected(page, "ZipProfile");
    await expectNotSelected(page, "WebDeploy");
  });

  test("switching project profiles transfers selection", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await gotoAppWithPublishConfig(page);

    await page.locator(selectBtn("ZipProfile")).click();
    await expectNotSelected(page, "FolderProfile");
    await expectSelected(page, "ZipProfile");

    expect(errors).toEqual([]);
  });

  test("rapid preset switching ends with last clicked profile selected", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await gotoAppWithPublishConfig(page);

    for (let i = 0; i < 3; i++) {
      await page.locator(selectBtn("FolderProfile")).click();
      await page.locator(selectBtn("ZipProfile")).click();
      await page.locator(selectBtn("WebDeploy")).click();
    }

    await expectNotSelected(page, "FolderProfile");
    await expectNotSelected(page, "ZipProfile");
    await expectSelected(page, "WebDeploy");

    expect(errors).toEqual([]);
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
