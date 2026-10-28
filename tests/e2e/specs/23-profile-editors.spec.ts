/**
 * 23-profile-editors — profile 行内编辑器的 e2e 准绳：
 * 自定义 profile 的更多操作菜单暴露「发布组合」与（仅 tauri provider）
 * 「发布设置」入口。组合编辑器保存走 update_profile（新修订回写
 * composition）；发布设置编辑器先 load_release_settings_draft 再
 * update_profile_release_settings，成功即关闭并提示新修订已保存。
 */
import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "../fixtures/mock-tauri";

async function openRowMenu(page: Page, rowSelector: string, name: string) {
  const row = page.locator(rowSelector);
  await row.hover();
  await row.getByRole("button", { name: `更多操作: ${name}` }).click();
}

async function invokedCommands(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      (window as unknown as { __MOCK_INVOCATIONS__: string[] })
        .__MOCK_INVOCATIONS__
  );
}

test.describe("Profile editors", () => {
  test("composition editor saves a new revision via update_profile", async ({
    page,
  }) => {
    await gotoApp(page);
    await openRowMenu(
      page,
      "[data-list-item-id='userprofile:profile-folder']",
      "FolderProfile"
    );
    await page.getByRole("menuitem", { name: "发布组合" }).click();

    const saveButton = page.getByTestId("composition-save");
    await expect(saveButton).toBeEnabled({ timeout: 10000 });
    await saveButton.click();

    await expect(
      page.locator("[data-sonner-toast]", {
        hasText: "发布组合已保存为新修订",
      })
    ).toBeVisible({ timeout: 10000 });
    await expect
      .poll(async () =>
        (await invokedCommands(page)).includes("update_profile")
      )
      .toBe(true);
  });

  test("release settings dialog loads, saves, and refreshes profiles", async ({
    page,
  }) => {
    await gotoApp(page, { seedTauriProfile: true });
    await openRowMenu(
      page,
      "[data-list-item-id='userprofile:profile-tauri']",
      "TauriRelease"
    );
    await page.getByRole("menuitem", { name: "发布设置" }).click();

    const saveButton = page.getByTestId("release-settings-save");
    await expect(saveButton).toBeEnabled({ timeout: 10000 });
    await saveButton.click();

    await expect(
      page.locator("[data-sonner-toast]", {
        hasText: "发布设置已保存为新修订",
      })
    ).toBeVisible({ timeout: 10000 });
    await expect
      .poll(async () => {
        const calls = await invokedCommands(page);
        return (
          calls.includes("load_release_settings_draft") &&
          calls.includes("update_profile_release_settings")
        );
      })
      .toBe(true);
  });

  test("release settings entry is hidden for non-tauri profiles", async ({
    page,
  }) => {
    await gotoApp(page);
    await openRowMenu(
      page,
      "[data-list-item-id='userprofile:profile-zip']",
      "ZipProfile"
    );
    await expect(
      page.getByRole("menuitem", { name: "发布组合" })
    ).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "发布设置" })).toHaveCount(
      0
    );
  });

  test("delete confirmation soft-deletes the profile row", async ({ page }) => {
    await gotoApp(page);
    const row = page.locator("[data-list-item-id='userprofile:profile-zip']");
    await expect(row).toBeVisible({ timeout: 10000 });
    await openRowMenu(
      page,
      "[data-list-item-id='userprofile:profile-zip']",
      "ZipProfile"
    );
    await page.getByRole("menuitem", { name: "删除配置" }).click();
    await page.getByRole("button", { name: "删除", exact: true }).click();
    await expect(row).toHaveCount(0, { timeout: 10000 });
    await expect
      .poll(async () =>
        (await invokedCommands(page)).includes("delete_profile")
      )
      .toBe(true);
  });
});
