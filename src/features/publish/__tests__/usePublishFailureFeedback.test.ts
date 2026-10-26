import { describe, expect, it } from "vitest";

import { getPublishFailureFeedback } from "@/features/publish/usePublishFailureFeedback";

describe("getPublishFailureFeedback", () => {
  it("maps every known failure reason to dedicated copy", () => {
    const cases: Array<[string, string]> = [
      ["already_running", "已有发布任务正在执行"],
      ["project_path_not_found", "项目路径不存在"],
      ["output_path_invalid", "发布目录无效"],
      ["output_path_incompatible", "发布目录路径与当前系统不兼容"],
      ["protected_directory_access_denied", "缺少 macOS 受保护目录访问权限"],
      ["remote_target_not_implemented", "远程发布通道尚未启用"],
      ["unsupported_provider", "不支持的 Provider"],
      ["render_error", "参数渲染失败"],
      ["tool_missing", "缺少构建命令"],
      ["permission_denied", "缺少执行权限"],
      ["plan_invalid", "发布计划无效"],
      ["java_gradle_missing", "未检测到 Gradle"],
      ["process_failed", "发布进程执行失败"],
    ];

    for (const [reason, expectedTitle] of cases) {
      const feedback = getPublishFailureFeedback(reason, {}, "raw error");
      expect(feedback.title, reason).toBe(expectedTitle);
      expect(feedback.description.length, reason).toBeGreaterThan(0);
    }
  });

  it("surfaces the backend message for path/permission reasons", () => {
    for (const reason of [
      "output_path_invalid",
      "output_path_incompatible",
      "protected_directory_access_denied",
    ]) {
      const feedback = getPublishFailureFeedback(reason, {}, "backend detail");
      expect(feedback.description, reason).toBe("backend detail");
    }
  });

  it("falls back to the generic execution error for unknown reasons", () => {
    const feedback = getPublishFailureFeedback("something_new", {}, "oops");
    expect(feedback).toEqual({
      title: "发布执行错误",
      description: "oops",
    });

    const nullReason = getPublishFailureFeedback(null, {}, "oops2");
    expect(nullReason.title).toBe("发布执行错误");
  });

  it("prefers translations over built-in copy", () => {
    const feedback = getPublishFailureFeedback(
      "already_running",
      {
        publishAlreadyRunning: "Publish in progress",
        publishAlreadyRunningDesc: "Wait for it to finish.",
      },
      "raw"
    );

    expect(feedback).toEqual({
      title: "Publish in progress",
      description: "Wait for it to finish.",
    });
  });
});
