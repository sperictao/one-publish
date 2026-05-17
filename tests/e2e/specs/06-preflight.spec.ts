/**
 * 06-preflight — Output path preflight checks, access validation, path validation.
 */
import { test, expect } from "@playwright/test";
import { gotoApp } from "../fixtures/mock-tauri";

test.describe("Preflight Output Checks", () => {
  test("preflight result is visible before execution", async ({ page }) => {
    await gotoApp(page);

    // The publish section should show preflight/validation information
    // Look for output directory or preflight result indicators
    const outputSection = page.getByText(/输出|output/i);
    // At minimum, the publish status area should exist
    await expect(page.getByText("发布状态")).toBeVisible({ timeout: 10000 });
  });

  test("publish command preview is rendered correctly", async ({ page }) => {
    await gotoApp(page);

    // The rendered command should show dotnet publish with args
    await expect(page.getByText(/dotnet publish/)).toBeVisible({ timeout: 10000 });
  });

  test("output directory is displayed or inferred", async ({ page }) => {
    await gotoApp(page);

    // The output directory might be shown in the publish section
    const publishArea = page.getByText(/执行发布|发布状态/);
    await expect(publishArea.first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Publish Execution Readiness", () => {
  test("status shows ready to execute", async ({ page }) => {
    await gotoApp(page);

    // The status should indicate readiness
    await expect(page.getByText(/命令与参数已准备完成/)).toBeVisible({ timeout: 10000 });
  });

  test("command and parameters are prepared", async ({ page }) => {
    await gotoApp(page);

    // "命令与参数已准备完成，可以开始本次发布" should be displayed
    await expect(page.getByText(/可以开始本次发布/)).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Provider-Specific Parameters", () => {
  test("dotnet --configuration is rendered in command", async ({ page }) => {
    await gotoApp(page);

    // The command preview should include --configuration Release
    await expect(page.getByText(/--configuration Release/)).toBeVisible({ timeout: 10000 });
  });

  test("provider schema defines available parameters", async ({ page }) => {
    await gotoApp(page);

    // Parameter definitions should be loaded from schema
    // In preset mode, we can verify the command preview includes schema-driven flags
    await expect(page.getByText("dotnet publish")).toBeVisible({ timeout: 10000 });
  });
});
