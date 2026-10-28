/**
 * 17-settings-dialog — 设置对话框的 e2e 准绳：
 * 打开设置 → 主题卡片切换立即作用于 documentElement；语言切换即时更新
 * 界面文案。两项偏好经 update_preferences 落库（mock 后端 get_app_state
 * 可读回）——持久化断言在导航前完成，因为 init-script mock 的状态不跨
 * 页面重载存活。
 */
import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "../fixtures/mock-tauri";

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "打开设置" }).click();
  await expect(page.getByRole("dialog", { name: "应用设置" })).toBeVisible({
    timeout: 10000,
  });
}

function appState(page: Page) {
  return page.evaluate(async () => {
    const win = window as unknown as {
      __TAURI_INTERNALS__?: {
        invoke: (c: string, a?: Record<string, unknown>) => Promise<unknown>;
      };
    };
    if (!win.__TAURI_INTERNALS__?.invoke) {
      throw new Error("Mock Tauri not installed");
    }
    return win.__TAURI_INTERNALS__.invoke("get_app_state") as Promise<{
      theme?: string;
      language?: string;
    }>;
  });
}

test.describe("Settings dialog", () => {
  test("主题切换即时应用并持久化到偏好", async ({ page }) => {
    await gotoApp(page);
    await openSettings(page);
    await page.getByRole("button", { name: "外观" }).click();

    await page.getByRole("button", { name: /暗色/ }).click();
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.classList.contains("dark"))
      )
      .toBe(true);

    // 偏好持久化有 ~500ms 防抖；轮询至后端可读回。
    await expect.poll(async () => (await appState(page)).theme).toBe("dark");
  });

  test("语言切换即时更新界面并持久化到偏好", async ({ page }) => {
    await gotoApp(page);
    await openSettings(page);

    await page.locator("#settings-language").click();
    await page.getByRole("option", { name: "English" }).click();

    await expect(page.getByText("Interface Language")).toBeVisible({
      timeout: 10000,
    });
    await expect.poll(async () => (await appState(page)).language).toBe("en");
  });

  test("检查更新呈现新版本并可安装至重启提示", async ({ page }) => {
    await gotoApp(page, {
      simulateTauri: true,
      updaterConfigHealth: { configured: true, message: null },
      updateInfo: {
        current_version: "0.6.3",
        available_version: "0.7.0",
        has_update: true,
        release_notes: "Bug fixes",
        message: null,
      },
      installUpdateMessage: "更新已安装，重启应用后生效",
    });
    await openSettings(page);
    await page.getByRole("button", { name: "关于" }).click();
    await page.getByRole("button", { name: "检查更新" }).click();
    const installButton = page.getByRole("button", {
      name: "更新",
      exact: true,
    });
    await expect(installButton).toBeVisible({ timeout: 10000 });
    await installButton.click();

    await expect(
      page.getByRole("button", { name: /重启应用|重启中/ })
    ).toBeVisible({ timeout: 10000 });
    await expect
      .poll(async () =>
        page.evaluate(() =>
          (
            window as unknown as { __MOCK_INVOCATIONS__: string[] }
          ).__MOCK_INVOCATIONS__.includes("install_update")
        )
      )
      .toBe(true);

    // 点击重启 → plugin-process relaunch → plugin:process|restart 调用；
    // mock 下 relaunch 保持 pending 语义，按钮定格为「重启中…」。
    await page.getByRole("button", { name: "重启应用" }).click();
    await expect(page.getByRole("button", { name: "重启中…" })).toBeVisible({
      timeout: 10000,
    });
    await expect
      .poll(async () =>
        page.evaluate(() =>
          (
            window as unknown as { __MOCK_INVOCATIONS__: string[] }
          ).__MOCK_INVOCATIONS__.includes("plugin:process|restart")
        )
      )
      .toBe(true);
  });

  test("下载进度事件在安装期间驱动进度条", async ({ page }) => {
    await gotoApp(page, {
      simulateTauri: true,
      updaterConfigHealth: { configured: true, message: null },
      updateInfo: {
        current_version: "0.6.3",
        available_version: "0.7.0",
        has_update: true,
        release_notes: null,
        message: null,
      },
      installUpdateLatch: true,
    });
    await openSettings(page);
    await page.getByRole("button", { name: "关于" }).click();
    await page.getByRole("button", { name: "检查更新" }).click();
    await page.getByRole("button", { name: "更新", exact: true }).click();

    // install_update 挂起在闩锁上——此时注入进度事件，进度条可见。
    await page.evaluate(() => {
      (
        window as unknown as {
          __MOCK_EMIT_EVENT__: (event: string, payload: unknown) => void;
        }
      ).__MOCK_EMIT_EVENT__("updater-download-progress", {
        stage: "downloading",
        version: "0.7.0",
        downloadedBytes: 420,
        totalBytes: 1000,
        percent: 42,
      });
    });
    await expect(page.getByText("正在下载更新…")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText("42%")).toBeVisible({ timeout: 10000 });

    await page.evaluate(() => {
      (
        window as unknown as { __MOCK_RESOLVE_INSTALL_UPDATE__: () => void }
      ).__MOCK_RESOLVE_INSTALL_UPDATE__();
    });
    await expect(
      page.getByRole("button", { name: /重启应用|重启中/ })
    ).toBeVisible({ timeout: 10000 });
  });

  test("更新源未配置时换档为指南入口并调用 open_updater_help", async ({
    page,
  }) => {
    await gotoApp(page, {
      simulateTauri: true,
      updaterConfigHealth: {
        configured: false,
        message: "No updater configured",
      },
    });
    await openSettings(page);
    await page.getByRole("button", { name: "关于" }).click();

    const guideButton = page.getByRole("button", { name: "打开配置指南" });
    await expect(guideButton).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByRole("button", { name: "打开模板文件" })
    ).toBeVisible();
    // 不健康档位下常规检查/安装按钮换出。
    await expect(
      page.getByRole("button", { name: "检查更新" })
    ).not.toBeVisible();

    // 不健康档位先经 get_updater_help_paths 装载帮助路径。
    await expect
      .poll(async () =>
        page.evaluate(() =>
          (
            window as unknown as { __MOCK_INVOCATIONS__: string[] }
          ).__MOCK_INVOCATIONS__.includes("get_updater_help_paths")
        )
      )
      .toBe(true);

    await guideButton.click();
    await expect
      .poll(async () =>
        page.evaluate(() =>
          (
            window as unknown as {
              __MOCK_INVOKE_ARGS__: { cmd: string; args?: unknown }[];
            }
          ).__MOCK_INVOKE_ARGS__.some(
            (entry) =>
              entry.cmd === "open_updater_help" &&
              (entry.args as { target?: string })?.target === "docs"
          )
        )
      )
      .toBe(true);
  });

  test("快捷键视图加载并展示帮助条目", async ({ page }) => {
    await gotoApp(page);
    await openSettings(page);
    await page.getByRole("button", { name: "快捷键", exact: true }).click();
    await page.getByRole("button", { name: "查看快捷键" }).click();

    const dialog = page.getByRole("dialog", { name: "快捷键" });
    await expect(dialog.getByText("Publish")).toBeVisible({
      timeout: 10000,
    });
    await expect(dialog.getByText("Ctrl+P")).toBeVisible();
    await expect
      .poll(async () =>
        page.evaluate(() =>
          (
            window as unknown as { __MOCK_INVOCATIONS__: string[] }
          ).__MOCK_INVOCATIONS__.includes("get_shortcuts_help")
        )
      )
      .toBe(true);
  });
});
