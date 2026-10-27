/**
 * 19-diagnostics-index — 诊断索引导出入口的 e2e 准绳：
 * 历史卡提供「导出诊断索引」按钮（恢复此前被重构移出的已交付能力）；
 * 有可索引来源（记录携带 snapshotPath）时经保存对话框导出并 toast
 * 反馈路径。
 */
import { test, expect } from "@playwright/test";
import { gotoApp } from "../fixtures/mock-tauri";

const baseRecord = {
  configurationId: null,
  configurationRevisionId: null,
  providerId: "dotnet",
  cancelled: false,
  error: null,
  commandLine: "$ dotnet publish App.csproj",
  failureSignature: null,
  outputExcerpt: null,
  spec: null,
  fileCount: 12,
  warnings: [],
};

test.describe("Diagnostics index export", () => {
  test("快照记录存在时按钮可导出并反馈路径", async ({ page }) => {
    await gotoApp(page, {
      dialogSavePath: "/tmp/diagnostics-index.html",
      initialState: {
        executionHistory: [
          {
            ...baseRecord,
            id: "diag-idx-1",
            repoId: "repo-a",
            projectPath: "/workspace/alpha-service/App.csproj",
            outputDir: "/workspace/alpha-service/bin/Release",
            snapshotPath: "/tmp/snapshots/alpha.json",
            startedAt: "2026-04-02T10:00:00.000Z",
            finishedAt: "2026-04-02T10:00:03.000Z",
            success: true,
          },
        ],
      },
    });
    await page.getByRole("button", { name: "历史记录" }).click();
    await expect(page.getByText("最近执行历史")).toBeVisible();

    const button = page.getByTestId("export-diagnostics-index-btn");
    await expect(button).toBeVisible();
    await button.click();

    const toast = page.locator("[data-sonner-toast]");
    await expect(toast).toBeVisible({ timeout: 10000 });
    await expect(toast).toContainText("诊断索引已导出");
  });

  test("无可索引来源时按钮提示而非导出", async ({ page }) => {
    await gotoApp(page, {
      dialogSavePath: "/tmp/diagnostics-index.html",
      initialState: {
        executionHistory: [
          {
            ...baseRecord,
            id: "diag-idx-2",
            repoId: "repo-a",
            projectPath: "/workspace/beta-service/Beta.csproj",
            outputDir: "/workspace/beta-service/bin/Release",
            snapshotPath: null,
            startedAt: "2026-04-01T10:00:00.000Z",
            finishedAt: "2026-04-01T10:00:03.000Z",
            success: true,
          },
        ],
      },
    });
    await page.getByRole("button", { name: "历史记录" }).click();
    await expect(page.getByText("最近执行历史")).toBeVisible();

    await page.getByTestId("export-diagnostics-index-btn").click();

    const toast = page.locator("[data-sonner-toast]");
    await expect(toast).toBeVisible({ timeout: 10000 });
    await expect(toast).toContainText("暂无可索引的诊断导出记录");
  });
});
