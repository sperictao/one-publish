import { expect, test } from "@playwright/test";

import { gotoApp, installMockTauri } from "../fixtures/mock-tauri";

async function gotoVariant(
  page: Parameters<typeof installMockTauri>[0],
  variant: string
) {
  await installMockTauri(page);
  await page.goto(`/?variant=${variant}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
}

test.describe("Geist prototype cleanup", () => {
  test("keeps the normal app route unchanged without variant", async ({
    page,
  }) => {
    await gotoApp(page);

    await expect(page.getByTestId("geist-prototype-switcher")).toHaveCount(0);
    await expect(page.locator("[data-list-item-id='repo-a']")).toBeVisible();
  });

  // 原型 A 路由已随原型清理整体移除（页面源码中不再存在 Dense Workbench /
  // prototype switcher），对应的 A 路由对比与暗色用例随之删除。

  test("does not render removed B/C prototype variants", async ({ page }) => {
    for (const variant of ["B", "C"] as const) {
      await gotoVariant(page, variant);

      await expect(page.getByTestId("geist-prototype-switcher")).toHaveCount(0);
      await expect(page.getByText(/Prototype -/)).toHaveCount(0);
      await expect(page.locator("[data-list-item-id='repo-a']")).toBeVisible();
    }
  });
});
