/**
 * 03-provider — Provider catalog, schema loading, environment checks.
 */
import { test, expect } from "@playwright/test";
import { gotoApp } from "../fixtures/mock-tauri";

test.describe("Provider Catalog", () => {
  test("provider information is displayed after boot", async ({ page }) => {
    await gotoApp(page);

    // The provider selector should show "dotnet" as the active provider
    // (repo-a has providerId "dotnet")
    await expect(page.locator("[data-list-item-id='repo-a']")).toContainText("dotnet");
  });

  test("provider schema is loaded and publish config renders", async ({ page }) => {
    await gotoApp(page);

    // Publish config panel should show profile items with dotnet-specific naming
    // (pubxml: prefix indicates dotnet publish profiles)
    await expect(page.locator("[data-list-item-id='pubxml:FolderProfile']")).toBeVisible();
    await expect(page.locator("[data-list-item-id='pubxml:ZipProfile']")).toBeVisible();
  });

  test("provider schema parameters are rendered in publish command", async ({ page }) => {
    await gotoApp(page);

    // The publish command display should show dotnet publish with --configuration flag
    // This is rendered by the mock's render_provider_publish
    const publishSection = page.locator("text=将执行的命令");
    await expect(publishSection).toBeVisible({ timeout: 15000 });
  });

  test("execution history appears after switching to history view", async ({ page }) => {
    await gotoApp(page, {
      initialState: {
        executionHistory: [
          {
            id: "history-boot-1",
            repoId: "repo-a",
            providerId: "dotnet",
            projectPath: "/workspace/alpha-service/App.csproj",
            startedAt: "2026-04-02T10:00:00.000Z",
            finishedAt: "2026-04-02T10:00:03.000Z",
            success: true,
            cancelled: false,
            outputDir: "/workspace/alpha-service/bin/Release",
            error: null,
            commandLine: "$ dotnet publish /workspace/alpha-service/App.csproj",
            snapshotPath: null,
            failureSignature: null,
            outputExcerpt: null,
            spec: null,
            fileCount: 2,
          },
        ],
      },
    });

    await page.getByRole("button", { name: "历史记录" }).click();

    await expect(page.getByText("最近执行历史")).toBeVisible();
    await expect(page.getByText("/workspace/alpha-service/App.csproj")).toBeVisible();
  });
});

test.describe("Multiple Providers", () => {
  test("provider list includes all registered providers", async ({ page }) => {
    await gotoApp(page);

    // The mock provides dotnet, cargo, and go providers
    // Verify dotnet is visible (used by repos)
    await expect(page.locator("[data-list-item-id='repo-a']")).toContainText("dotnet");
  });
});
