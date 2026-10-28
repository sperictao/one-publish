/**
 * 22-automation-bindings — 自动化绑定区的空态与守卫准绳：
 * 仓库配置的 provider 均非 tauri 时展示「无 tauri 配置」提示并禁用
 * 绑定入口；提示内的新建按钮进入快速创建对话框；空绑定视图不出现
 * 漂移横幅。mock 的 list_automation_bindings 返回空视图。
 */
import { test, expect } from "@playwright/test";
import { gotoApp } from "../fixtures/mock-tauri";

test.describe("Automation bindings section", () => {
  test("renders for the selected repository", async ({ page }) => {
    await gotoApp(page);
    await expect(page.getByTestId("automation-bindings-section")).toBeVisible({
      timeout: 10000,
    });
  });

  test("shows the no-tauri-profile hint and disables install", async ({
    page,
  }) => {
    await gotoApp(page);
    await expect(page.getByTestId("automation-no-tauri-profile")).toBeVisible({
      timeout: 10000,
    });
    await expect(
      page.getByRole("button", { name: /绑定自动化/ })
    ).toBeDisabled();
  });

  test("empty bindings view renders no drift banner", async ({ page }) => {
    await gotoApp(page);
    await expect(page.getByTestId("automation-bindings-section")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByTestId("automation-drift-banner")).toHaveCount(0);
  });

  test("hint's create-profile button opens the quick-create dialog", async ({
    page,
  }) => {
    await gotoApp(page);
    const hint = page.getByTestId("automation-no-tauri-profile");
    await expect(hint).toBeVisible({ timeout: 10000 });
    await hint.getByRole("button", { name: "新建配置" }).click();
    await expect(
      page.getByRole("dialog", { name: "创建发布配置" })
    ).toBeVisible({ timeout: 10000 });
  });
});
