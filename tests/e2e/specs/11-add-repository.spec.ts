/**
 * 11-add-repository — 添加仓库的用户任务语义（e2e 回归）
 *
 * 覆盖 ui-audit(add-java-repo) 确认的四条关键回归语义：
 *  1. 成功添加 → 列表新增 + 自动选中 + toast 回显识别结果
 *  2. 重复路径 → 友好的「该目录已添加为仓库「x」」（不泄漏原始序列化负载）
 *  3. 未识别到 Provider → 照常落库并打开编辑窗口手动选择（不再是死路）
 *  4. 慢检测期间 → "+" 按钮 busy 反馈（disabled + aria-busy），完成后恢复
 *
 * 说明：本文件源自 ui-audit(add-dotnet-repo) 的同名回归用例，合并进本 PR 后
 * 按「检测失败照常落库 + 手动选择」的语义改写了第 3 条。
 */
import { test, expect } from "@playwright/test";
import { gotoApp } from "../fixtures/mock-tauri";

const addButton = (page: import("@playwright/test").Page) =>
  page.getByTestId("repo-add-button");

const toast = (page: import("@playwright/test").Page) =>
  page.locator("[data-sonner-toast]");

const repoRows = (page: import("@playwright/test").Page) =>
  page.locator(".repo-list-root [data-list-item-id]");

test.describe("添加仓库", () => {
  test("添加成功后列表新增并自动选中", async ({ page }) => {
    await gotoApp(page, { dialogOpenPath: "/workspace/new-repo" });

    await addButton(page).click();

    const newRow = page.locator("[data-list-item-id]", {
      hasText: "new-repo",
    });
    await expect(newRow).toBeVisible();
    await expect(
      newRow.first().locator("button[aria-pressed]")
    ).toHaveAttribute("aria-pressed", "true");
    await expect(toast(page)).toContainText("仓库已添加");
  });

  test("重复路径提示可读文案，不泄漏原始错误", async ({ page }) => {
    await gotoApp(page, { dialogOpenPath: "/workspace/alpha-service" });

    await addButton(page).click();

    await expect(toast(page)).toContainText("该目录已添加为仓库");
    await expect(toast(page)).not.toContainText("repository_exists");
    await expect(toast(page)).not.toContainText('{"code"');
    // 列表保持原样
    await expect(repoRows(page)).toHaveCount(2);
  });

  test("未识别到 Provider 时照常落库并打开手动选择入口", async ({ page }) => {
    await gotoApp(page, {
      dialogOpenPath: "/workspace/plain-dir",
      errors: {
        detect_repository_provider:
          "cannot detect provider from repository path",
      },
    });

    await addButton(page).click();

    // 不再是死路：仓库已入库，且手动选择 Provider 的入口真实存在
    await expect(toast(page)).toContainText("已添加仓库，请手动选择 Provider");
    await expect(repoRows(page)).toHaveCount(3);
    await expect(page.locator("#repo-edit-provider")).toBeVisible();
  });

  test("检测耗时期间添加按钮呈现 busy 状态并在完成后恢复", async ({ page }) => {
    await gotoApp(page, { dialogOpenPath: "/workspace/new-repo" });

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

    const button = addButton(page);
    await button.click();
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute("aria-busy", "true");

    // 完成后 busy 解除，仓库入库
    await expect(button).toBeEnabled({ timeout: 10_000 });
    await expect(button).toHaveAttribute("aria-busy", "false");
    await expect(
      page.locator("[data-list-item-id]", { hasText: "new-repo" })
    ).toBeVisible();
  });
});
