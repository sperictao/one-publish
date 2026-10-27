/**
 * 21-config-export — Phase 11 候选 A 的导出腿 e2e 准绳：
 * 「导出 -> 在新环境导入 -> 跑通 preflight」的导出段——spec 13 已覆盖
 * 导入冲突三选一与导入后 dry-run，本 spec 钉住导出写路径：
 * 保存对话框路径透传到 export_config 命令载荷，成功后 toast 反馈实际路径。
 */
import { test, expect } from "@playwright/test";
import { gotoApp } from "../fixtures/mock-tauri";

test.describe("Config export (Phase 11 candidate A)", () => {
  test("导出配置经保存对话框写文件并 toast 反馈路径", async ({ page }) => {
    await gotoApp(page, {
      dialogSavePath: "/tmp/one-publish-config.json",
    });
    await page.getByRole("button", { name: /配置管理/i }).click();
    await page.getByRole("button", { name: "导出配置" }).click();

    // export_config 收到 repo 与保存对话框选定路径。
    await expect
      .poll(async () => {
        return page.evaluate(() => {
          const win = window as unknown as {
            __MOCK_INVOKE_ARGS__?: Array<{
              cmd: string;
              args?: Record<string, unknown>;
            }>;
          };
          return (win.__MOCK_INVOKE_ARGS__ ?? []).filter(
            (entry) => entry.cmd === "export_config"
          );
        });
      })
      .toEqual([
        expect.objectContaining({
          args: expect.objectContaining({
            repoId: "repo-a",
            filePath: "/tmp/one-publish-config.json",
          }),
        }),
      ]);

    const toast = page.locator("[data-sonner-toast]");
    await expect(toast).toBeVisible({ timeout: 10000 });
    await expect(toast).toContainText("配置已导出");
    await expect(toast).toContainText("/tmp/one-publish-config.json");
  });

  test("导出失败经 toast 呈现而非静默", async ({ page }) => {
    await gotoApp(page, {
      dialogSavePath: "/tmp/one-publish-config.json",
      errors: { export_config: "disk full" },
    });
    await page.getByRole("button", { name: /配置管理/i }).click();
    await page.getByRole("button", { name: "导出配置" }).click();

    const toast = page.locator("[data-sonner-toast]");
    await expect(toast).toBeVisible({ timeout: 10000 });
    await expect(toast).toContainText("导出配置失败");
  });
});
