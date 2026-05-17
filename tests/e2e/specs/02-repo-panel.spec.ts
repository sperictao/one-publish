/**
 * 02-repo-panel — Repository management: list, select, search, branch indicators.
 */
import { test, expect } from "@playwright/test";
import { gotoApp } from "../fixtures/mock-tauri";

test.describe("Repository List", () => {
  test("displays all repositories from app state", async ({ page }) => {
    await gotoApp(page);

    const repoA = page.locator("[data-list-item-id='repo-a']");
    const repoB = page.locator("[data-list-item-id='repo-b']");

    await expect(repoA).toBeVisible();
    await expect(repoB).toBeVisible();
    await expect(repoA).toContainText("alpha-service");
    await expect(repoB).toContainText("beta-worker");
  });

  test("first repository is selected by default", async ({ page }) => {
    await gotoApp(page);

    const repoABtn = page.locator("[data-list-item-id='repo-a'] button[aria-pressed]");
    await expect(repoABtn).toHaveAttribute("aria-pressed", "true");

    const repoBBtn = page.locator("[data-list-item-id='repo-b'] button[aria-pressed]");
    await expect(repoBBtn).toHaveAttribute("aria-pressed", "false");
  });

  test("clicking a repository selects it and updates aria-pressed", async ({ page }) => {
    await gotoApp(page);

    // Click repo-b
    await page.locator("[data-list-item-id='repo-b'] button[aria-pressed]").click();

    // Wait for selection to propagate — repo-b should now be pressed
    await expect(page.locator("[data-list-item-id='repo-b'] button[aria-pressed]")).toHaveAttribute("aria-pressed", "true");

    // repo-b should now be pressed, repo-a should not
    await expect(page.locator("[data-list-item-id='repo-b'] button[aria-pressed]")).toHaveAttribute("aria-pressed", "true");
    // repo-a should be deselected
    const repoAPressed = await page.locator("[data-list-item-id='repo-a'] button[aria-pressed]").getAttribute("aria-pressed");
    expect(repoAPressed).not.toBe("true");
  });

  test("shows branch name for each repository", async ({ page }) => {
    await gotoApp(page);

    // repo-a is on main branch
    await expect(page.locator("[data-list-item-id='repo-a']")).toContainText("main");
    // repo-b is on release branch
    await expect(page.locator("[data-list-item-id='repo-b']")).toContainText("release");
  });

  test("shows provider badge for each repository", async ({ page }) => {
    await gotoApp(page);

    await expect(page.locator("[data-list-item-id='repo-a']")).toContainText("dotnet");
    await expect(page.locator("[data-list-item-id='repo-b']")).toContainText("dotnet");
  });

  test("search filters repositories", async ({ page }) => {
    await gotoApp(page);

    const searchBox = page.locator("input[placeholder*='搜索仓库']");
    if (await searchBox.isVisible()) {
      await searchBox.fill("alpha");

      // repo-a should still be visible, repo-b should be hidden
      await expect(page.locator("[data-list-item-id='repo-a']")).toBeVisible();
      await expect(page.locator("[data-list-item-id='repo-b']")).not.toBeVisible();
    }
  });
});

test.describe("Repository Path Display", () => {
  test("shows repository file path", async ({ page }) => {
    await gotoApp(page);

    await expect(page.locator("[data-list-item-id='repo-a']")).toContainText("/workspace/alpha-service");
  });
});
