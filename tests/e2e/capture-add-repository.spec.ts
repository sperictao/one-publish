/**
 * ui-audit capture: 添加仓库
 *
 * 录制「仓库列表 → 添加仓库(+) → 目录选择 → 自动检测 Provider → 入库」的
 * 完整用户任务。Baseline 与 After 共用本文件，保证用户路径完全一致；
 * 差异仅在断言强度（UI_AUDIT_PHASE）。
 *
 * 运行（常规 e2e 自动跳过）：
 *   UI_AUDIT_CAPTURE=1 UI_AUDIT_PHASE=baseline pnpm e2e --grep capture-add-repository
 *   UI_AUDIT_CAPTURE=1 UI_AUDIT_PHASE=after    pnpm e2e --grep capture-add-repository
 *
 * 产物：test-results/ui-audit/add-repository/<phase>/
 */
import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { gotoApp, type MockTauriOptions } from "./fixtures/mock-tauri";

const CAPTURE = !!process.env.UI_AUDIT_CAPTURE;
const PHASE = process.env.UI_AUDIT_PHASE === "after" ? "after" : "baseline";
const OUT_DIR = path.resolve("test-results/ui-audit/add-repository", PHASE);

const observations: Array<{ tag: string; detail: string }> = [];

function observe(tag: string, detail: string) {
  const line = `[OBSERVE][${PHASE}] ${tag}: ${detail}`;
  console.log(line);
  observations.push({ tag, detail });
}

test.skip(!CAPTURE, "capture-only spec（UI_AUDIT_CAPTURE=1 时运行）");

async function shot(page: Page, name: string) {
  await page.screenshot({
    path: path.join(OUT_DIR, `${name}.png`),
    fullPage: false,
  });
}

async function collectToasts(page: Page): Promise<string[]> {
  return page
    .locator("[data-sonner-toast]")
    .allInnerTexts()
    .catch(() => []);
}

async function countRepoRows(page: Page): Promise<number> {
  return page.locator(".repo-list-root [data-list-item-id]").count();
}

/** 添加流程进行中是否存在任何 busy/loading 反馈。 */
async function describeAddBusyState(page: Page): Promise<string> {
  const addButton = page.getByTestId("repo-add-button");
  const disabled = await addButton.getAttribute("disabled").catch(() => null);
  const ariaBusy = await addButton.getAttribute("aria-busy").catch(() => null);
  const anySpinner = await page
    .locator(
      ".repo-list-root [aria-busy='true'], .repo-list-root .animate-spin"
    )
    .count()
    .catch(() => 0);
  return JSON.stringify({
    addButtonDisabled: disabled !== null,
    addButtonAriaBusy: ariaBusy,
    anySpinnerInRepoPanel: anySpinner,
  });
}

async function assertToastAfter(
  page: Page,
  expectContains: string[],
  expectNotContains: string[]
) {
  const toasts = page.locator("[data-sonner-toast]");
  // 同屏可能残留其它 toast，逐条按文本定位，避免 strict mode 冲突。
  for (const text of expectContains) {
    await expect(toasts.filter({ hasText: text }).first()).toBeVisible();
  }
  const allText = (await toasts.allInnerTexts()).join("\n");
  for (const text of expectNotContains) {
    expect(allText).not.toContain(text);
  }
  observe(
    "after.toast",
    `contains ${JSON.stringify(expectContains)}, excludes ${JSON.stringify(expectNotContains)}`
  );
}

for (const scenario of [
  {
    name: "A-add-success",
    options: { dialogOpenPath: "/workspace/new-repo" } as MockTauriOptions,
    run: async (page: Page) => {
      await page.getByTestId("repo-add-button").click();
      await shot(page, "A-02-after-add");
      await page.waitForTimeout(1_500);
      observe("A.toasts", JSON.stringify(await collectToasts(page)));
      observe(
        "A.list-after-add",
        JSON.stringify(
          await page
            .locator(".repo-list-root")
            .innerText()
            .catch(() => "")
        )
      );
      observe(
        "A.selected-row",
        JSON.stringify(
          await page
            .locator('[data-list-item-id] button[aria-pressed="true"]')
            .count()
        )
      );
      if (PHASE === "after") {
        const newRow = page.locator("[data-list-item-id]", {
          hasText: "new-repo",
        });
        await expect(newRow).toBeVisible();
        await expect(
          newRow.first().locator("button[aria-pressed]")
        ).toHaveAttribute("aria-pressed", "true");
        await assertToastAfter(page, ["仓库已添加"], ['{"code"']);
        observe(
          "after.new-row-selected",
          "new-repo row visible + aria-pressed"
        );
      }
      await shot(page, "A-03-settled");
    },
  },
  {
    name: "B-detect-failure",
    options: {
      dialogOpenPath: "/workspace/plain-dir",
      errors: {
        detect_repository_provider:
          "cannot detect provider from repository path",
      },
    } as MockTauriOptions,
    run: async (page: Page) => {
      await page.getByTestId("repo-add-button").click();
      await page.waitForTimeout(1_500);
      await shot(page, "B-02-after-detect-failure");
      observe("B.toasts", JSON.stringify(await collectToasts(page)));
      if (PHASE === "after") {
        // 未识别到 Provider 不再中断成死路：照常落库并打开手动选择入口。
        await assertToastAfter(
          page,
          ["已添加仓库，请手动选择 Provider"],
          ['{"code"']
        );
        await expect(page.locator("#repo-edit-provider")).toBeVisible();
        observe("after.recovery-entry", "#repo-edit-provider visible");
      }
      observe("B.repo-count", String(await countRepoRows(page)));
    },
  },
  {
    name: "A2-add-slow-detect",
    options: { dialogOpenPath: "/workspace/new-repo" } as MockTauriOptions,
    run: async (page: Page) => {
      // 注入 1.4s 检测延迟，模拟慢磁盘/网络盘下的真实耗时
      // （录制规范建议 pending 状态 mock 延迟 1200–1600ms）。
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
      await page.getByTestId("repo-add-button").click();
      await shot(page, "A2-02-clicked-plus");
      await page.waitForTimeout(400);
      await shot(page, "A2-03-detecting-400ms");
      observe("A2.busy-at-400ms", await describeAddBusyState(page));
      if (PHASE === "after") {
        const addButton = page.getByTestId("repo-add-button");
        await expect(addButton).toBeDisabled();
        await expect(addButton).toHaveAttribute("aria-busy", "true");
        observe("after.add-button-busy", "disabled + aria-busy during detect");
      }
      await page.waitForTimeout(1_000);
      await shot(page, "A2-04-detecting-1400ms");
      observe("A2.busy-at-1400ms", await describeAddBusyState(page));
      await page.waitForTimeout(1_500);
      await shot(page, "A2-05-after-add");
      observe("A2.toasts", JSON.stringify(await collectToasts(page)));
      observe("A2.repo-count", String(await countRepoRows(page)));
    },
  },
  {
    name: "C-duplicate-path",
    options: {
      dialogOpenPath: "/workspace/alpha-service",
    } as MockTauriOptions,
    run: async (page: Page) => {
      await page.getByTestId("repo-add-button").click();
      await page.waitForTimeout(1_500);
      await shot(page, "C-02-after-duplicate");
      observe("C.toasts", JSON.stringify(await collectToasts(page)));
      if (PHASE === "after") {
        await assertToastAfter(
          page,
          ["该目录已添加为仓库"],
          ["repository_exists", '{"code"']
        );
      }
      observe("C.repo-count", String(await countRepoRows(page)));
    },
  },
]) {
  test(`capture-add-repository ${scenario.name}`, async ({
    browser,
  }, testInfo) => {
    mkdirSync(OUT_DIR, { recursive: true });
    // 自建 context 录像：本机 Playwright 1.58 的 page.video().saveAs() 会让
    // fixture teardown 挂死（最小复现 probe-video），因此改为 context.close()
    // 后直接取落盘的 webm。
    const videoDir = path.join(OUT_DIR, `${scenario.name}-video`);
    mkdirSync(videoDir, { recursive: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 820 },
      recordVideo: { dir: videoDir, size: { width: 1440, height: 820 } },
    });
    const page = await context.newPage();
    await gotoApp(page, scenario.options);
    await shot(page, `${scenario.name}-01-boot`);

    await scenario.run(page);

    await page.waitForTimeout(1_000);
    await shot(page, `${scenario.name}-99-settled`);

    await context.close();
    const recordings = readdirSync(videoDir).filter((f) => f.endsWith(".webm"));
    if (recordings.length > 0) {
      const videoPath = path.join(OUT_DIR, `${scenario.name}.webm`);
      renameSync(path.join(videoDir, recordings[0]), videoPath);
      rmSync(videoDir, { recursive: true, force: true });
      observe(`${scenario.name}.video`, videoPath);
    } else {
      observe(`${scenario.name}.video`, "<missing>");
    }

    testInfo.attach("observations.json", {
      body: JSON.stringify(observations, null, 2),
      contentType: "application/json",
    });
  });
}
