import { expect, test, type Page } from "@playwright/test";
import { gotoApp } from "../fixtures/mock-tauri";

/**
 * 状态栏托盘发布流：真实 Tauri 运行时中托盘菜单发出
 * `tray-publish-request` 事件；simulateTauri 解锁 isTauri() 门控后，
 * __MOCK_EMIT_EVENT__ 向已注册的 listen 回调投递载荷，验证
 * 解析 → runPublishSpec → 运行时启动的完整链路。
 */

async function emitEvent(
  page: Page,
  event: string,
  payload: unknown
): Promise<void> {
  await page.evaluate(
    ([name, body]) => {
      (
        window as unknown as {
          __MOCK_EMIT_EVENT__: (event: string, payload: unknown) => void;
        }
      ).__MOCK_EMIT_EVENT__(name as string, body);
    },
    [event, payload] as const
  );
}

async function mockInvocations(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      (window as unknown as { __MOCK_INVOCATIONS__: string[] })
        .__MOCK_INVOCATIONS__
  );
}

async function mockInvokeArgsFor(
  page: Page,
  command: string
): Promise<unknown> {
  return page.evaluate((cmd) => {
    const entries =
      (
        window as unknown as {
          __MOCK_INVOKE_ARGS__: { cmd: string; args?: unknown }[];
        }
      ).__MOCK_INVOKE_ARGS__ ?? [];
    return entries.filter((entry) => entry.cmd === cmd).map((e) => e.args);
  }, command);
}

test.describe("Tray publish request", () => {
  test("tray-publish-request resolves the profile and starts the runtime", async ({
    page,
  }) => {
    await gotoApp(page, {
      simulateTauri: true,
      seedTauriProfile: true,
    });

    await emitEvent(page, "tray-publish-request", {
      repoId: "repo-a",
      configKey: "userprofile:profile-tauri",
    });

    await expect
      .poll(async () =>
        (await mockInvocations(page)).includes("start_publish_runtime")
      )
      .toBe(true);
    // 托盘状态效果随发布生命周期回写。
    await expect
      .poll(async () =>
        (await mockInvocations(page)).includes("set_tray_publish_status")
      )
      .toBe(true);
  });

  test("invalid tray config key reports failure via tray status", async ({
    page,
  }) => {
    await gotoApp(page, {
      simulateTauri: true,
      seedTauriProfile: true,
    });

    await emitEvent(page, "tray-publish-request", {
      repoId: "repo-a",
      configKey: "not-a-valid-key",
    });

    await expect
      .poll(async () =>
        (await mockInvocations(page)).includes("set_tray_publish_status")
      )
      .toBe(true);
    const args = (await mockInvokeArgsFor(page, "set_tray_publish_status")) as {
      status?: string;
    }[];
    expect(args.some((arg) => arg?.status === "failure")).toBe(true);
    // 失败路径不再触达运行时。
    expect(
      (await mockInvocations(page)).includes("start_publish_runtime")
    ).toBe(false);
  });

  test("publish session events stream log chunks into the output view", async ({
    page,
  }) => {
    await gotoApp(page, {
      simulateTauri: true,
      seedTauriProfile: true,
    });

    // 后端在 spawn 前发出会话开始事件，chunk 监听据此锁存会话。
    await emitEvent(page, "provider-publish-session-started", {
      sessionId: "session-e2e-1",
    });
    await emitEvent(page, "provider-publish-log", {
      sessionId: "session-e2e-1",
      line: "[build] compiling crates/one-publish-runner\n",
    });
    await emitEvent(page, "provider-publish-log", {
      sessionId: "session-e2e-1",
      line: "[build] finished in 3.2s\n",
    });

    await expect(
      page.getByText(/compiling crates\/one-publish-runner/)
    ).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/finished in 3\.2s/)).toBeVisible({
      timeout: 10000,
    });
  });
});
