/**
 * 14-handoff-bundle-export — Phase 11 候选 C 的 e2e 准绳：
 * 失败运行从历史卡片导出单一交接包（含命令、快照、失败分组的 zip），
 * 成功路径 toast 反馈实际写入路径。包内容契约由后端 zip 解包测试钉死。
 */
import { test, expect } from "@playwright/test";
import { gotoApp } from "../fixtures/mock-tauri";

test.describe("Handoff bundle export (Phase 11 candidate C)", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page, {
      dialogSavePath: "/tmp/one-publish-handoff.zip",
      initialState: {
        executionHistory: [
          {
            id: "handoff-failed-1",
            repoId: "repo-a",
            configurationId: null,
            configurationRevisionId: null,
            providerId: "dotnet",
            projectPath: "/workspace/alpha-service/App.csproj",
            startedAt: "2026-04-02T10:00:00.000Z",
            finishedAt: "2026-04-02T10:00:03.000Z",
            success: false,
            cancelled: false,
            outputDir: "/workspace/alpha-service/bin/Release/publish",
            error: "MSB3021: 未能复制文件",
            commandLine:
              "$ dotnet publish /workspace/alpha-service/App.csproj -c Release",
            snapshotPath: null,
            failureSignature: "compile-error",
            outputExcerpt: null,
            spec: null,
            fileCount: 0,
            warnings: null,
          },
        ],
      },
    });
    await page.getByRole("button", { name: "历史记录" }).click();
    await expect(page.getByText("最近执行历史")).toBeVisible();
  });

  test("失败运行可导出交接包并反馈写入路径", async ({ page }) => {
    await page.getByRole("button", { name: "导出交接包" }).click();

    const toast = page.locator("[data-sonner-toast]");
    await expect(toast).toBeVisible({ timeout: 10000 });
    await expect(toast).toContainText("交接包已导出");
    await expect(toast).toContainText("/tmp/one-publish-handoff.zip");
  });

  test("取消保存对话框时不导出、不报错", async ({ page }) => {
    // mock save 返回 null（用户取消）；通过 window 覆盖本用例的对话框结果。
    await page.evaluate(() => {
      (
        window as unknown as { __MOCK_DIALOG_SAVE__: unknown }
      ).__MOCK_DIALOG_SAVE__ = null;
    });
    await page.getByRole("button", { name: "导出交接包" }).click();

    // 等 save 调用确实到达 mock 后断言：取消路径提前返回，不发起导出写文件。
    const invocations = () =>
      page.evaluate(
        () =>
          (window as unknown as { __MOCK_INVOCATIONS__: string[] })
            .__MOCK_INVOCATIONS__
      );
    await expect
      .poll(async () => (await invocations()).includes("plugin:dialog|save"))
      .toBe(true);
    await page.waitForTimeout(300);
    expect(await invocations()).not.toContain("export_handoff_bundle");
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
    await expect(page.getByText("MSB3021: 未能复制文件")).toBeVisible();
  });
});
