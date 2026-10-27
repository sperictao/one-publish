/**
 * 18-environment-check — 设置内环境检查的 e2e 准绳：
 * 进入环境检查页自动触发 run_environment_check，结果按勾选的 provider
 * 集合裁剪（默认 environmentProviderIds 仅 dotnet，go 的问题与状态行
 * 不出现）；勾选 go 后重新检查，未安装问题与修复动作呈现；open_url
 * 修复经 apply_fix 执行并显示执行结果。
 */
import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "../fixtures/mock-tauri";

async function openEnvironmentTab(page: Page) {
  await page.getByRole("button", { name: "打开设置" }).click();
  await expect(page.getByRole("dialog", { name: "应用设置" })).toBeVisible({
    timeout: 10000,
  });
  await page.getByRole("button", { name: "环境检查" }).click();
  // 进入页面即自动执行一次检查
  await expect(page.getByText("工具状态")).toBeVisible({ timeout: 15000 });
}

test.describe("Environment check", () => {
  test("默认作用域仅检查勾选的 provider", async ({ page }) => {
    await gotoApp(page);
    await openEnvironmentTab(page);

    await expect(page.getByText("已就绪")).toBeVisible();
    await expect(page.getByText("dotnet", { exact: true })).toBeVisible();
    // go 未勾选：其工具状态行与 missing_tool 问题均被裁剪
    await expect(page.getByText("Go is not installed")).toHaveCount(0);
  });

  test("勾选 provider 后重新检查呈现问题与修复动作", async ({ page }) => {
    await gotoApp(page);
    await openEnvironmentTab(page);

    await page.getByRole("button", { name: /go 1\.23/ }).click();
    await page.getByRole("button", { name: "重新检查" }).click();

    await expect(page.getByText("Go is not installed")).toBeVisible({
      timeout: 15000,
    });
    await expect(
      page.getByRole("button", { name: "Install Go" })
    ).toBeVisible();
  });

  test("点击修复动作执行 apply_fix 并显示执行结果", async ({ page }) => {
    await gotoApp(page);
    await openEnvironmentTab(page);

    await page.getByRole("button", { name: /go 1\.23/ }).click();
    await page.getByRole("button", { name: "重新检查" }).click();
    await expect(page.getByRole("button", { name: "Install Go" })).toBeVisible({
      timeout: 15000,
    });

    await page.getByRole("button", { name: "Install Go" }).click();
    await expect(page.getByText("执行结果")).toBeVisible({ timeout: 10000 });
  });
});
