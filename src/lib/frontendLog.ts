// frontendLog - 前端日志桥
// 把 console.* 与全局未处理错误接入 tauri-plugin-log 的 Rust 日志面；
// release 构建默认写 LogDir，前端异常由此进入诊断证据链，
// 不再只落在不可见的 webview devtools 控制台。

import { isTauri } from "@tauri-apps/api/core";
import { attachConsole } from "@tauri-apps/plugin-log";

let installed = false;

function describeRejectionReason(reason: unknown): string {
  if (reason instanceof Error) {
    return `${reason.name}: ${reason.message}`;
  }
  try {
    return JSON.stringify(reason) ?? String(reason);
  } catch {
    return String(reason);
  }
}

/**
 * 安装全局前端错误钩子（幂等）：
 * - `attachConsole` 把既有 console.*（全代码库既有日志惯例）转发进 Rust 日志；
 * - `error`/`unhandledrejection` 覆盖 React 边界之外的全局异步与脚本错误，
 *   两者都经 console.error 走同一转发通道。
 * 非 Tauri 环境（vitest/e2e mock 之外的无内部对象场景）不安装。
 */
export function installFrontendErrorHooks(): void {
  if (installed || !isTauri()) {
    return;
  }
  installed = true;

  void attachConsole().catch(() => {
    // 日志桥自身失败必须静默——诊断基础设施永远不能打断应用。
  });

  window.addEventListener("error", (event) => {
    console.error(
      `[unhandled] ${event.message} at ${event.filename}:${event.lineno}:${event.colno}`
    );
  });
  window.addEventListener("unhandledrejection", (event) => {
    console.error(
      `[unhandledrejection] ${describeRejectionReason(event.reason)}`
    );
  });
}

// test-only helper
export function __resetFrontendErrorHooksForTest(): void {
  installed = false;
}
