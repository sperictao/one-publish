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
    // openOutputDirOnSuccess:true —— 成功后打开输出目录。
    await expect
      .poll(async () =>
        (await mockInvocations(page)).includes("open_output_directory")
      )
      .toBe(true);
    // publish:completed → savePublishRecord —— 执行历史落账。
    await expect
      .poll(async () =>
        (await mockInvocations(page)).includes("add_execution_record")
      )
      .toBe(true);
    // feedbackMode:"system" —— 完成反馈走系统通知而非 toast。
    await expect
      .poll(async () =>
        (await mockInvocations(page)).includes("show_system_notification")
      )
      .toBe(true);
  });

  test("output-dir open failure surfaces a system error notification", async ({
    page,
  }) => {
    await gotoApp(page, {
      simulateTauri: true,
      seedTauriProfile: true,
      errors: { open_output_directory: "permission denied" },
    });

    await emitEvent(page, "tray-publish-request", {
      repoId: "repo-a",
      configKey: "userprofile:profile-tauri",
    });

    // 发布成功 → open_output_directory 抛错 → notifyFeedback 经 system
    // 模式发出「打开输出目录失败」通知。
    await expect
      .poll(async () =>
        (await mockInvocations(page)).includes("open_output_directory")
      )
      .toBe(true);
    await expect
      .poll(async () => {
        const args = (await mockInvokeArgsFor(
          page,
          "show_system_notification"
        )) as { title?: string }[];
        return args.some((arg) =>
          (arg?.title ?? "").includes("打开输出目录失败")
        );
      })
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
    // 系统通知送达（缺省 true）→ 不回落主窗口恢复。
    expect(
      (await mockInvocations(page)).includes("show_system_notification")
    ).toBe(true);
    expect((await mockInvocations(page)).includes("show_main_window")).toBe(
      false
    );
  });

  test("runtime failure reports via tray status and system notification", async ({
    page,
  }) => {
    await gotoApp(page, {
      simulateTauri: true,
      seedTauriProfile: true,
      errors: { start_publish_runtime: "backend crashed" },
    });

    await emitEvent(page, "tray-publish-request", {
      repoId: "repo-a",
      configKey: "userprofile:profile-tauri",
    });

    // 解析成功但运行期失败 → publish:failed：托盘 failure 状态 +
    // system 反馈走 show_system_notification + 失败记录落账。
    await expect
      .poll(async () =>
        (await mockInvocations(page)).includes("start_publish_runtime")
      )
      .toBe(true);
    await expect
      .poll(async () => {
        const args = (await mockInvokeArgsFor(
          page,
          "set_tray_publish_status"
        )) as { status?: string }[];
        return args.some((arg) => arg?.status === "failure");
      })
      .toBe(true);
    await expect
      .poll(async () =>
        (await mockInvocations(page)).includes("show_system_notification")
      )
      .toBe(true);
    await expect
      .poll(async () =>
        (await mockInvocations(page)).includes("add_execution_record")
      )
      .toBe(true);
  });

  test("notification failure falls back to restoring the main window", async ({
    page,
  }) => {
    await gotoApp(page, {
      simulateTauri: true,
      seedTauriProfile: true,
      errors: { show_system_notification: "notification permission denied" },
    });

    await emitEvent(page, "tray-publish-request", {
      repoId: "repo-a",
      configKey: "not-a-valid-key",
    });

    // 通知失败 → showSystemNotification 回落 false → showMainWindow 恢复。
    await expect
      .poll(async () =>
        (await mockInvocations(page)).includes("show_main_window")
      )
      .toBe(true);
    expect(
      (await mockInvocations(page)).includes("set_tray_publish_status")
    ).toBe(true);
  });

  test("cancel during tray publish resets tray status to idle", async ({
    page,
  }) => {
    await gotoApp(page, {
      simulateTauri: true,
      seedTauriProfile: true,
      publishRuntimeLatch: true,
    });

    await emitEvent(page, "tray-publish-request", {
      repoId: "repo-a",
      configKey: "userprofile:profile-tauri",
    });

    // 运行中（闩锁挂起）→ 取消 → publish:cancelled：托盘归位 idle
    // 且取消记录照常落账。
    await expect
      .poll(async () =>
        (await mockInvocations(page)).includes("start_publish_runtime")
      )
      .toBe(true);
    const cancelBtn = page.getByRole("button", { name: "取消发布" });
    await expect(cancelBtn).toBeVisible({ timeout: 15000 });
    await cancelBtn.click();
    await expect
      .poll(async () =>
        (await mockInvocations(page)).includes("cancel_publish_runtime")
      )
      .toBe(true);
    await page.evaluate(() => {
      (
        window as unknown as {
          __MOCK_RESOLVE_PUBLISH_RUNTIME__: () => void;
        }
      ).__MOCK_RESOLVE_PUBLISH_RUNTIME__();
    });
    await expect
      .poll(async () => {
        const args = (await mockInvokeArgsFor(
          page,
          "set_tray_publish_status"
        )) as { status?: string }[];
        return args.some((arg) => arg?.status === "idle");
      })
      .toBe(true);
    await expect
      .poll(async () =>
        (await mockInvocations(page)).includes("add_execution_record")
      )
      .toBe(true);
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
