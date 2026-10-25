/**
 * 12-handoff-snippets — Phase 11 候选 B 的 e2e 准绳：
 * 成功记录经 UI 生成的交接片段覆盖 2 provider × 2 格式（shell / gitlab-ci），
 * 断言剪贴板内容与 handoffSnippet 构建器的契约（stage 段、cd、命令行）。
 */
import { test, expect } from "@playwright/test";
import type { JsonValue } from "@/generated/tauri-contracts";
import { gotoApp } from "../fixtures/mock-tauri";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

function successRecord(overrides: {
  id: string;
  providerId: string;
  projectPath: string;
  commandLine: string;
  spec: { [key: string]: JsonValue };
}) {
  return {
    id: overrides.id,
    repoId: "repo-a",
    configurationId: null,
    configurationRevisionId: null,
    providerId: overrides.providerId,
    projectPath: overrides.projectPath,
    startedAt: "2026-04-02T10:00:00.000Z",
    finishedAt: "2026-04-02T10:00:03.000Z",
    success: true,
    cancelled: false,
    outputDir: "/workspace/out",
    error: null,
    commandLine: overrides.commandLine,
    snapshotPath: null,
    failureSignature: null,
    outputExcerpt: null,
    spec: overrides.spec,
    fileCount: 2,
    warnings: null,
  };
}

async function readClipboard(page: import("@playwright/test").Page) {
  return page.evaluate(() => navigator.clipboard.readText());
}

test.describe("Handoff snippets (Phase 11 candidate B)", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page, {
      initialState: {
        executionHistory: [
          successRecord({
            id: "handoff-dotnet",
            providerId: "dotnet",
            projectPath: "/workspace/alpha-service/App.csproj",
            commandLine:
              "$ dotnet publish /workspace/alpha-service/App.csproj -c Release",
            spec: {
              version: 1,
              provider_id: "dotnet",
              project_path: "/workspace/alpha-service/App.csproj",
              parameters: { configuration: "Release" },
            },
          }),
          successRecord({
            id: "handoff-cargo",
            providerId: "cargo",
            projectPath: "/workspace/beta-cli",
            commandLine: "$ cargo build --release",
            spec: {
              version: 1,
              provider_id: "cargo",
              project_path: "/workspace/beta-cli",
              parameters: { release: true },
            },
          }),
        ],
      },
    });
    await page.getByRole("button", { name: "历史记录" }).click();
    await expect(page.getByText("最近执行历史")).toBeVisible();
    // 清空剪贴板初值，避免上一条测试的残留干扰断言。
    await page.evaluate(() =>
      navigator.clipboard.writeText("__clipboard_reset__")
    );
  });

  test("dotnet 成功记录生成 GitLab CI 片段", async ({ page }) => {
    const dotnetRow = page.locator("div.rounded-sm.border", {
      hasText: "/workspace/alpha-service/App.csproj",
    });

    await dotnetRow
      .getByRole("button", { name: "复制 GitLab CI 片段" })
      .click();

    const snippet = await readClipboard(page);
    expect(snippet).toContain("publish:");
    expect(snippet).toContain("stage: deploy");
    expect(snippet).toContain('cd "/workspace/alpha-service"');
    expect(snippet).toContain(
      "dotnet publish /workspace/alpha-service/App.csproj -c Release"
    );
  });

  test("dotnet 成功记录生成 Shell 片段", async ({ page }) => {
    const dotnetRow = page.locator("div.rounded-sm.border", {
      hasText: "/workspace/alpha-service/App.csproj",
    });

    await dotnetRow.getByRole("button", { name: "复制 Shell 片段" }).click();

    const snippet = await readClipboard(page);
    expect(snippet).toContain("# OnePublish handoff snippet (shell)");
    expect(snippet).toContain("# provider: dotnet");
    expect(snippet).toContain('cd "/workspace/alpha-service"');
    expect(snippet).toContain(
      "dotnet publish /workspace/alpha-service/App.csproj -c Release"
    );
  });

  test("cargo 成功记录生成 GitLab CI 片段", async ({ page }) => {
    const cargoRow = page.locator("div.rounded-sm.border", {
      hasText: "/workspace/beta-cli",
    });

    await cargoRow.getByRole("button", { name: "复制 GitLab CI 片段" }).click();

    const snippet = await readClipboard(page);
    expect(snippet).toContain("stage: deploy");
    expect(snippet).toContain('cd "/workspace/beta-cli"');
    expect(snippet).toContain("cargo build --release");
  });

  test("cargo 成功记录生成 Shell 片段", async ({ page }) => {
    const cargoRow = page.locator("div.rounded-sm.border", {
      hasText: "/workspace/beta-cli",
    });

    await cargoRow.getByRole("button", { name: "复制 Shell 片段" }).click();

    const snippet = await readClipboard(page);
    expect(snippet).toContain("# provider: cargo");
    expect(snippet).toContain("cargo build --release");
  });
});
