import { expect, test } from "@playwright/test";

import { gotoApp, installMockTauri } from "../fixtures/mock-tauri";

async function gotoVariant(page: Parameters<typeof installMockTauri>[0], variant: string) {
  await installMockTauri(page);
  await page.goto(`/?variant=${variant}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
}

test.describe("Geist prototype cleanup", () => {
  test("keeps the normal app route unchanged without variant", async ({ page }) => {
    await gotoApp(page);

    await expect(page.getByTestId("geist-prototype-switcher")).toHaveCount(0);
    await expect(page.locator("[data-list-item-id='repo-a']")).toBeVisible();
  });

  test("keeps only the selected A prototype route for comparison", async ({ page }) => {
    await gotoVariant(page, "A");

    await expect(page.getByTestId("geist-prototype-switcher")).toHaveCount(0);
    await expect(page.getByText("Prototype - A - Dense Workbench")).toBeVisible();
    await expect(page.getByText("alpha-service").first()).toBeVisible();
  });

  test("does not render removed B/C prototype variants", async ({ page }) => {
    for (const variant of ["B", "C"] as const) {
      await gotoVariant(page, variant);

      await expect(page.getByTestId("geist-prototype-switcher")).toHaveCount(0);
      await expect(page.getByText(/Prototype -/)).toHaveCount(0);
      await expect(page.locator("[data-list-item-id='repo-a']")).toBeVisible();
    }
  });

  test("keeps prototype readable in dark mode", async ({ page }) => {
    await gotoVariant(page, "A");
    await page.locator("html").evaluate((node) => node.classList.add("dark"));

    await expect(page.getByText("Prototype - A - Dense Workbench")).toBeVisible();
    await expect(page.getByText("alpha-service").first()).toBeVisible();
  });
});
