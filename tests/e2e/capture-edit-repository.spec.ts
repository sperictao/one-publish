/**
 * ui-audit capture: 编辑仓库
 *
 * 录制「仓库行 → 更多操作 → 编辑仓库 → 修改字段 → 保存 → 验证持久化」
 * 的完整用户任务，以及对话框的自动行为（打开时自动扫描项目文件 /
 * 自动刷新分支 / 无 Provider 时自动检测）。Baseline 与 After 共用本
 * 文件保证用户路径一致；差异仅在断言强度（UI_AUDIT_PHASE）。
 *
 * 运行（常规 e2e 自动跳过）：
 *   UI_AUDIT_CAPTURE=1 UI_AUDIT_PHASE=baseline pnpm e2e --grep capture-edit-repository
 *   UI_AUDIT_CAPTURE=1 UI_AUDIT_PHASE=after    pnpm e2e --grep capture-edit-repository
 *
 * 产物：test-results/ui-audit/edit-repository/<phase>/
 */
import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import {
  DEFAULT_REPOSITORIES,
  gotoApp,
  type MockTauriOptions,
} from "./fixtures/mock-tauri";

const CAPTURE = !!process.env.UI_AUDIT_CAPTURE;
const PHASE = process.env.UI_AUDIT_PHASE === "after" ? "after" : "baseline";
const OUT_DIR = path.resolve("test-results/ui-audit/edit-repository", PHASE);

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

/** 打开仓库行菜单并进入编辑对话框。 */
async function openEditDialog(page: Page, repoName: string) {
  await page.getByRole("button", { name: `更多操作: ${repoName}` }).click();
  await page.getByRole("menuitem", { name: "编辑仓库" }).click();
  await expect(page.getByText("编辑项目信息")).toBeVisible();
}

async function describeSaveButton(page: Page): Promise<string> {
  const saveButton = page.getByRole("button", { name: /保存/ });
  const disabled =
    (await saveButton.getAttribute("disabled").catch(() => null)) !== null;
  const pendingHint = await page
    .getByText("正在扫描项目文件…")
    .isVisible()
    .catch(() => false);
  const bindingHint = await page
    .getByText("先选择一个 Project File")
    .isVisible()
    .catch(() => false);
  return JSON.stringify({ saveDisabled: disabled, pendingHint, bindingHint });
}

const REPO_WITHOUT_PROVIDER = {
  id: "repo-c",
  name: "gamma-tool",
  path: "/workspace/gamma-tool",
  currentBranch: "main",
  isMain: false,
  branches: [
    {
      name: "main",
      isMain: true,
      isCurrent: true,
      path: "/workspace/gamma-tool",
      commitCount: 3,
    },
  ],
  providerId: null,
  projectFile: null,
  publishConfig: {
    profiles: [],
    bindings: [],
    appliedBundles: [],
    drafts: [],
  },
};

for (const scenario of [
  {
    name: "E1-edit-happy",
    options: {} as MockTauriOptions,
    run: async (page: Page) => {
      await openEditDialog(page, "alpha-service");
      // 打开即触发：项目文件扫描（250ms 防抖）+ 分支自动刷新。
      await page.waitForTimeout(300);
      await shot(page, "E1-02-just-opened");
      observe("E1.state-at-open", await describeSaveButton(page));
      await page.waitForTimeout(1_200);
      await shot(page, "E1-03-settled");
      observe("E1.state-settled", await describeSaveButton(page));
      const dialogText = await page
        .locator("[role='dialog'], body")
        .first()
        .innerText()
        .catch(() => "");
      observe(
        "E1.dialog-snippet",
        dialogText.slice(0, 400).replace(/\n+/g, " | ")
      );

      await page.getByLabel("仓库名称").fill("alpha-service-renamed");
      await page.getByRole("button", { name: "保存" }).click();
      await page.waitForTimeout(1_200);
      await shot(page, "E1-04-after-save");
      const toasts = await collectToasts(page);
      observe("E1.toasts", JSON.stringify(toasts));
      const dialogStillOpen = await page
        .getByText("编辑项目信息")
        .isVisible()
        .catch(() => false);
      observe("E1.dialog-still-open", String(dialogStillOpen));
      const rowText = await page
        .locator("[data-list-item-id='repo-a']")
        .innerText()
        .catch(() => "<row missing>");
      observe("E1.row-after-save", JSON.stringify(rowText));
      if (PHASE === "after") {
        expect(dialogStillOpen).toBe(false);
        await expect(page.getByText("仓库信息已更新")).toBeVisible();
        await expect(
          page.locator("[data-list-item-id='repo-a']")
        ).toContainText("alpha-service-renamed");
        observe("after.edit-persisted", "toast + row renamed + dialog closed");
      }
    },
  },
  {
    name: "E2-auto-bind-no-provider",
    options: {
      repositories: [...DEFAULT_REPOSITORIES, REPO_WITHOUT_PROVIDER],
    } as MockTauriOptions,
    run: async (page: Page) => {
      await openEditDialog(page, "gamma-tool");
      await page.waitForTimeout(300);
      await shot(page, "E2-02-just-opened");
      await page.waitForTimeout(1_500);
      await shot(page, "E2-03-settled");
      const toasts = await collectToasts(page);
      observe("E2.toasts", JSON.stringify(toasts));
      const boundBadge = await page
        .getByText("已绑定")
        .isVisible()
        .catch(() => false);
      observe("E2.bound-visible", String(boundBadge));
      observe("E2.state", await describeSaveButton(page));
      if (PHASE === "after") {
        // 自动检测绑定 dotnet、扫描回填推荐 Project File、保存可用。
        await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
        expect(boundBadge).toBe(true);
        expect(
          await page.getByRole("button", { name: "保存" }).isDisabled()
        ).toBe(false);
        await expect(page.locator("#repo-edit-project-file")).toContainText(
          "App.csproj"
        );
        observe(
          "after.auto-bind",
          "no error toast, provider bound, recommended project file applied, save enabled"
        );
      }
    },
  },
  {
    name: "E3-empty-name",
    options: {} as MockTauriOptions,
    run: async (page: Page) => {
      await openEditDialog(page, "alpha-service");
      await page.waitForTimeout(1_200);
      await page.getByLabel("仓库名称").fill("");
      await page.waitForTimeout(300);
      await shot(page, "E3-02-empty-name");
      observe("E3.state", await describeSaveButton(page));
      const inlineError = await page
        .getByText("输入仓库名称")
        .isVisible()
        .catch(() => false);
      observe("E3.inline-error", String(inlineError));
      const nameErrorVisible = await page
        .getByText("输入项目根目录路径")
        .isVisible()
        .catch(() => false);
      observe("E3.path-error-visible", String(nameErrorVisible));
      if (PHASE === "after") {
        expect(
          await page.getByRole("button", { name: "保存" }).isDisabled()
        ).toBe(true);
        observe("after.save-disabled-empty-name", "save stays disabled");
      }
    },
  },
  {
    name: "E4-binding-required",
    options: {} as MockTauriOptions,
    run: async (page: Page) => {
      // 路径改为多项目目录：mock 扫描返回 2 个项目文件且无推荐绑定。
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
          if (cmd === "scan_project_candidates") {
            const root =
              (args?.startPath as string) || "/workspace/alpha-service";
            return {
              rootPath: root,
              solutionFiles: [`${root}/Multi.sln`],
              projectFiles: [`${root}/A.csproj`, `${root}/B.csproj`],
              recommendedProjectFile: undefined,
            };
          }
          return invoke(cmd, args);
        };
      });
      await openEditDialog(page, "alpha-service");
      await page.getByLabel("Project Root").fill("/workspace/multi-project");
      await page.waitForTimeout(1_500);
      await shot(page, "E4-02-multi-project");
      observe("E4.state", await describeSaveButton(page));
      if (PHASE === "after") {
        expect(
          await page.getByRole("button", { name: "保存" }).isDisabled()
        ).toBe(true);
        await expect(page.getByText("先选择一个 Project File")).toBeVisible();
        observe(
          "after.binding-required",
          "save disabled + inline binding hint for multi-project repo"
        );
      }
    },
  },
  {
    name: "E5-save-failure",
    options: {
      errors: { update_repository: "backend rejected the update" },
    } as MockTauriOptions,
    run: async (page: Page) => {
      await openEditDialog(page, "alpha-service");
      await page.waitForTimeout(1_200);
      await page.getByLabel("仓库名称").fill("alpha-service-tmp");
      await page.getByRole("button", { name: "保存" }).click();
      await page.waitForTimeout(1_500);
      await shot(page, "E5-02-after-save-failure");
      const toasts = await collectToasts(page);
      observe("E5.toasts", JSON.stringify(toasts));
      const dialogStillOpen = await page
        .getByText("编辑项目信息")
        .isVisible()
        .catch(() => false);
      observe("E5.dialog-still-open", String(dialogStillOpen));
      if (PHASE === "after") {
        await expect(page.locator("[data-sonner-toast]")).toContainText(
          "更新仓库失败"
        );
        await expect(page.locator("[data-sonner-toast]")).not.toContainText(
          '{"code"'
        );
        await expect(page.locator("[data-sonner-toast]")).not.toContainText(
          "Error:"
        );
        observe(
          "after.save-failure",
          "failure toast shown, no raw error prefix or serialized error"
        );
      }
    },
  },
  {
    name: "E6-branch-refresh-failure",
    options: {
      errors: {
        scan_repository_branches:
          "fatal: not a git repository (or any of the parent directories): .git",
      },
    } as MockTauriOptions,
    run: async (page: Page) => {
      await openEditDialog(page, "alpha-service");
      await page.waitForTimeout(1_500);
      await shot(page, "E6-02-open-failed-refresh");
      const toasts = await collectToasts(page);
      observe("E6.toasts", JSON.stringify(toasts));
      observe("E6.state", await describeSaveButton(page));
      if (PHASE === "after") {
        // 开发态 StrictMode 会双触发自动刷新产生两条相同 toast；
        // 生产构建单条。断言锁定语义而非开发态伪影。
        await expect(page.locator("[data-sonner-toast]").first()).toContainText(
          "该目录不是 Git 仓库"
        );
        expect(
          await page.getByRole("button", { name: "保存" }).isDisabled()
        ).toBe(false);
        observe(
          "after.branch-refresh-failure",
          "failure context toast, save recoverable"
        );
      }
    },
  },
]) {
  test(`capture-edit-repository ${scenario.name}`, async ({
    browser,
  }, testInfo) => {
    mkdirSync(OUT_DIR, { recursive: true });
    const options: MockTauriOptions = { ...scenario.options };
    const videoDir = path.join(OUT_DIR, `${scenario.name}-video`);
    mkdirSync(videoDir, { recursive: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 820 },
      recordVideo: { dir: videoDir, size: { width: 1440, height: 820 } },
    });
    const page = await context.newPage();
    const invokeLogs: string[] = [];
    page.on("console", (msg) => {
      const text = msg.text();
      if (text.includes("[mock-tauri]") || text.includes("选择项目路径失败")) {
        invokeLogs.push(text);
      }
    });
    await gotoApp(page, options);
    await shot(page, `${scenario.name}-01-boot`);

    await scenario.run(page);

    await page.waitForTimeout(800);
    await shot(page, `${scenario.name}-99-settled`);
    if (invokeLogs.length > 0) {
      observe(
        `${scenario.name}.invoke-log`,
        JSON.stringify(invokeLogs.slice(-40))
      );
    }

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
