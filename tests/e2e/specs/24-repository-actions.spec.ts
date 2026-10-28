/**
 * 24-repository-actions — 仓库/profile 变更动作的 e2e 准绳：
 * 仓库行的编辑与移除走 update_repository / remove_repository；
 * 组合编辑器的项目重绑走 rebind_profile_project。三条命令均由
 * mock 建模为真实状态变更并返回新 AppState。
 */
import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "../fixtures/mock-tauri";

async function openRepoRowMenu(page: Page, repoId: string, name: string) {
  const row = page.locator(`[data-list-item-id='${repoId}']`);
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

test.describe("Repository actions", () => {
  test("edit dialog saves repository metadata via update_repository", async ({
    page,
  }) => {
    await gotoApp(page);
    await openRepoRowMenu(page, "repo-a", "alpha-service");
    await page.getByRole("menuitem", { name: "编辑仓库" }).click();

    await page.getByLabel("仓库名称").fill("alpha-service-renamed");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(
      page.locator("[data-sonner-toast]", { hasText: "仓库信息已更新" })
    ).toBeVisible({ timeout: 10000 });
    await expect
      .poll(async () =>
        (await invokedCommands(page)).includes("update_repository")
      )
      .toBe(true);
  });

  test("remove repository confirms via dialog and drops the row", async ({
    page,
  }) => {
    await gotoApp(page);
    const row = page.locator("[data-list-item-id='repo-b']");
    await expect(row).toBeVisible({ timeout: 10000 });
    await openRepoRowMenu(page, "repo-b", "beta-worker");
    await page.getByRole("menuitem", { name: "移除仓库" }).click();
    await expect(
      page.locator("[data-sonner-toast]", { hasText: "仓库已移除" })
    ).toBeVisible({ timeout: 10000 });
    await expect(row).toHaveCount(0);
    await expect
      .poll(async () =>
        (await invokedCommands(page)).includes("remove_repository")
      )
      .toBe(true);
  });

  test("composition editor rebinds the project candidate", async ({ page }) => {
    await gotoApp(page);
    const row = page.locator(
      "[data-list-item-id='userprofile:profile-folder']"
    );
    await row.hover();
    await row.getByRole("button", { name: "更多操作: FolderProfile" }).click();
    await page.getByRole("menuitem", { name: "发布组合" }).click();

    const rebindButton = page.getByTestId("composition-rebind");
    await expect(rebindButton).toBeEnabled({ timeout: 10000 });
    await rebindButton.click();
    await expect(
      page.locator("[data-sonner-toast]", {
        hasText: "已重新绑定到当前候选并产生新修订",
      })
    ).toBeVisible({ timeout: 10000 });
    await expect
      .poll(async () =>
        (await invokedCommands(page)).includes("rebind_profile_project")
      )
      .toBe(true);
  });
});
