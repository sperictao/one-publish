/**
 * 15-artifact-promotion — Issue #163 的 e2e 准绳：
 * 带封存 manifestDigest 的历史记录呈现「再交付」入口；点击后复用 history
 * 来源恢复原配置，并把 promotedManifestDigest 注入 prepare 请求的
 * runInputs，让 planner 走 Store+Delivery 纯交付链（ADR-0040）。
 * 无 digest 的记录不呈现该入口。
 */
import { test, expect } from "@playwright/test";
import { gotoApp } from "../fixtures/mock-tauri";

const PROMOTED_DIGEST =
  "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";

const baseRecord = {
  configurationId: null,
  configurationRevisionId: null,
  providerId: "dotnet",
  cancelled: false,
  error: null,
  commandLine: "$ dotnet publish App.csproj",
  snapshotPath: null,
  failureSignature: null,
  outputExcerpt: null,
  spec: null,
  fileCount: 12,
  warnings: null,
};

// 历史记录行容器（text-copy-14 是记录卡片专有类）。
const recordRow = (page: import("@playwright/test").Page, marker: string) =>
  page.locator("div.text-copy-14", { hasText: marker });

test.describe("Artifact promotion from execution history (Issue #163)", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page, {
      initialState: {
        executionHistory: [
          {
            ...baseRecord,
            id: "promote-ok-1",
            repoId: "repo-a",
            projectPath: "/workspace/alpha-service/App.csproj",
            outputDir: "/workspace/alpha-service/bin/Release",
            startedAt: "2026-04-02T10:00:00.000Z",
            finishedAt: "2026-04-02T10:00:03.000Z",
            success: true,
            manifestDigest: PROMOTED_DIGEST,
          },
          {
            ...baseRecord,
            id: "promote-none-1",
            repoId: "repo-a",
            projectPath: "/workspace/beta-service/Beta.csproj",
            outputDir: "/workspace/beta-service/bin/Release",
            startedAt: "2026-04-01T10:00:00.000Z",
            finishedAt: "2026-04-01T10:00:03.000Z",
            success: true,
          },
        ],
      },
    });
    await page.getByRole("button", { name: "历史记录" }).click();
    await expect(page.getByText("最近执行历史")).toBeVisible();
  });

  test("带 manifestDigest 的记录可从历史直接再交付", async ({ page }) => {
    const promoteButton = recordRow(page, "alpha-service").getByRole("button", {
      name: "再交付",
    });
    await expect(promoteButton).toBeVisible();

    await promoteButton.click();

    // 断言 prepare 请求：history 来源 + digest 注入 runInputs。
    type Invoke = {
      cmd: string;
      args?: {
        request?: {
          source?: { kind?: string; recordId?: string };
          runInputs?: { promotedManifestDigest?: string };
        };
      };
    };
    const invocations = () =>
      page.evaluate(
        () =>
          (window as unknown as { __MOCK_INVOKE_ARGS__: Invoke[] })
            .__MOCK_INVOKE_ARGS__
      );
    await expect
      .poll(async () =>
        (await invocations()).some(
          (i) =>
            i.cmd === "prepare_publish_runtime" &&
            i.args?.request?.source?.kind === "history" &&
            i.args?.request?.source?.recordId === "promote-ok-1" &&
            i.args?.request?.runInputs?.promotedManifestDigest ===
              PROMOTED_DIGEST
        )
      )
      .toBe(true);

    // 交付链继续推进到 start_publish_runtime。
    await expect
      .poll(async () =>
        (await invocations()).some((i) => i.cmd === "start_publish_runtime")
      )
      .toBe(true);
  });

  test("无 manifestDigest 的记录不呈现再交付入口", async ({ page }) => {
    await expect(
      recordRow(page, "alpha-service").getByRole("button", { name: "再交付" })
    ).toBeVisible();
    await expect(
      recordRow(page, "beta-service").getByRole("button", { name: "再交付" })
    ).toHaveCount(0);
    // 常规重跑入口两条记录都有，确认不是整排按钮缺失。
    await expect(
      recordRow(page, "beta-service").getByRole("button", { name: "重新执行" })
    ).toBeVisible();
  });
});
