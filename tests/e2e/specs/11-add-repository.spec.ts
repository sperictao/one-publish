/**
 * 11-add-repository — 添加 .NET 仓库的用户任务语义
 *
 * 覆盖 ui-audit(add-dotnet-repo)确认的三个缺陷的回归语义：
 *  1. 成功添加 → 列表新增 + 自动选中
 *  2. 重复路径 → 友好的「仓库已存在」提示（不泄漏原始错误）
 *  3. 检测失败 → 专用文案（不引导不存在的手动选择入口）
 *  4. 慢检测期间 → "+" 按钮 busy 反馈（disabled + aria-busy）
 */
import { test, expect } from "@playwright/test";
import { gotoApp } from "../fixtures/mock-tauri";

test.describe("添加仓库", () => {
  test("添加 .NET 仓库成功后列表新增并自动选中", async ({ page }) => {
    await gotoApp(page, { dialogOpenPath: "/workspace/dotnet-demo" });

    await page.getByTitle("添加仓库").click();

    await expect(
      page.locator("[data-list-item-id]", { hasText: "dotnet-demo" })
    ).toBeVisible();
    await expect(
      page
        .locator("[data-list-item-id]", { hasText: "dotnet-demo" })
        .locator("button[aria-pressed]")
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("仓库已添加")).toBeVisible();
  });

  test("重复路径提示仓库已存在，不显示原始错误", async ({ page }) => {
    await gotoApp(page, { dialogOpenPath: "/workspace/alpha-service" });

    await page.getByTitle("添加仓库").click();

    const toast = page.locator("[data-sonner-toast]");
    await expect(toast).toContainText("仓库已存在");
    await expect(toast).not.toContainText("repository_exists");
    await expect(toast).not.toContainText('{"code"');
    // 列表保持原样
    await expect(
      page.locator(".repo-list-root [data-list-item-id]")
    ).toHaveCount(2);
  });

  test("检测失败时使用专用文案且不引导手动选择入口", async ({ page }) => {
    await gotoApp(page, {
      dialogOpenPath: "/workspace/plain-dir",
      errors: {
        detect_repository_provider:
          "cannot detect provider from repository path",
      },
    });

    await page.getByTitle("添加仓库").click();

    const toast = page.locator("[data-sonner-toast]");
    await expect(toast).toContainText("未识别到支持的 Provider");
    await expect(toast).toContainText("未添加仓库");
    await expect(toast).not.toContainText("可手动选择 Provider");
    // 没有任何手动选择 Provider 的可点击入口被引入
    expect(
      await page.getByRole("button", { name: /手动选择|选择 Provider/ }).count()
    ).toBe(0);
    await expect(
      page.locator(".repo-list-root [data-list-item-id]")
    ).toHaveCount(2);
  });

  test("检测耗时期间添加按钮呈现 busy 状态并在完成后恢复", async ({ page }) => {
    await gotoApp(page, { dialogOpenPath: "/workspace/dotnet-demo" });

    await page.evaluate(() => {
      const internals = (
        window as unknown as {
          __TAURI_INTERNALS__: {
            invoke: (
              cmd: string,
              args?: Record<string, unknown>
            ) => Promise<unknown>;
          };
        }
      ).__TAURI_INTERNALS__;
      const invoke = internals.invoke;
      internals.invoke = async (cmd, args) => {
        if (cmd === "detect_repository_provider") {
          await new Promise((r) => setTimeout(r, 1_400));
        }
        return invoke(cmd, args);
      };
    });

    const addButton = page.getByTitle("添加仓库");
    await addButton.click();
    await expect(addButton).toBeDisabled();
    await expect(addButton).toHaveAttribute("aria-busy", "true");

    // 完成后 busy 解除，仓库入库
    await expect(addButton).toBeEnabled({ timeout: 10_000 });
    await expect(addButton).toHaveAttribute("aria-busy", "false");
    await expect(
      page.locator("[data-list-item-id]", { hasText: "dotnet-demo" })
    ).toBeVisible();
  });
});
