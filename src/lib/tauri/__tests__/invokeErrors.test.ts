import { describe, expect, it } from "vitest";

import {
  analyzeBranchRefreshFailure,
  analyzeProviderDetectFailure,
  analyzeProjectScanFailure,
  analyzePublishExecutionFailure,
  extractInvokeErrorCode,
  extractInvokeErrorDetails,
  extractInvokeErrorMessage,
  type BranchRefreshFailureReason,
  type ProjectScanFailureReason,
  type ProviderDetectFailureReason,
  type PublishExecutionFailureReason,
} from "@/lib/tauri/invokeErrors";

describe("extractInvokeErrorMessage", () => {
  it("string 错误原样返回", () => {
    expect(extractInvokeErrorMessage("plain failure")).toBe("plain failure");
  });

  it("object 按 message | details | error 顺序拼接，使用 ' | ' 分隔", () => {
    expect(
      extractInvokeErrorMessage({
        message: "first",
        details: "second",
        error: "third",
      })
    ).toBe("first | second | third");
  });

  it("object 拼接时跳过空串并 trim 各段", () => {
    expect(
      extractInvokeErrorMessage({
        message: "  padded  ",
        details: "   ",
        error: "tail",
      })
    ).toBe("padded | tail");
  });

  it("空对象回退到 JSON.stringify", () => {
    expect(extractInvokeErrorMessage({})).toBe("{}");
  });

  it("循环引用 object 回退到 String(error) 且不抛异常", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => extractInvokeErrorMessage(circular)).not.toThrow();
    expect(extractInvokeErrorMessage(circular)).toBe("[object Object]");
  });

  it("非 string 非 object（如 number）走 String(error)", () => {
    expect(extractInvokeErrorMessage(42)).toBe("42");
  });
});

describe("extractInvokeErrorCode", () => {
  it("object 顶层 code 返回小写化结果", () => {
    expect(extractInvokeErrorCode({ code: "PATH_NOT_FOUND" })).toBe(
      "path_not_found"
    );
  });

  it("支持 data.code 嵌套", () => {
    expect(extractInvokeErrorCode({ data: { code: "Tool_Missing" } })).toBe(
      "tool_missing"
    );
  });

  it("支持 details.code 嵌套", () => {
    expect(extractInvokeErrorCode({ details: { code: "RENDER_ERROR" } })).toBe(
      "render_error"
    );
  });

  it("顶层 code 优先于嵌套 code", () => {
    expect(
      extractInvokeErrorCode({
        code: "top_level",
        data: { code: "nested" },
      })
    ).toBe("top_level");
  });

  it("形似 JSON 的 string 会被 parse 后提取 code", () => {
    expect(extractInvokeErrorCode('{"code":"X"}')).toBe("x");
  });

  it("普通 string 返回 null", () => {
    expect(extractInvokeErrorCode("plain failure")).toBeNull();
  });

  it("以 { 包裹但非法 JSON 的 string 返回 null", () => {
    expect(extractInvokeErrorCode("{not valid json}")).toBeNull();
  });

  it("空 code 字符串返回 null", () => {
    expect(extractInvokeErrorCode({ code: "" })).toBeNull();
    expect(extractInvokeErrorCode({ code: "   " })).toBeNull();
  });

  it("非字符串 code（如 number）返回 null", () => {
    expect(extractInvokeErrorCode({ code: 1 })).toBeNull();
  });

  it("null / undefined / number 输入返回 null", () => {
    expect(extractInvokeErrorCode(null)).toBeNull();
    expect(extractInvokeErrorCode(undefined)).toBeNull();
    expect(extractInvokeErrorCode(1)).toBeNull();
  });
});

describe("extractInvokeErrorDetails", () => {
  it("extracts a top-level attempt identifier", () => {
    expect(
      extractInvokeErrorDetails({
        code: "publish_runtime_attempt_uncertain",
        details: "attempt-123",
      })
    ).toBe("attempt-123");
  });

  it("supports details nested under data", () => {
    expect(
      extractInvokeErrorDetails({
        data: { details: "attempt-456" },
      })
    ).toBe("attempt-456");
  });

  it("prefers top-level details and trims whitespace", () => {
    expect(
      extractInvokeErrorDetails({
        details: "  attempt-top  ",
        data: { details: "attempt-nested" },
      })
    ).toBe("attempt-top");
  });

  it("extracts details from a serialized invoke error", () => {
    expect(
      extractInvokeErrorDetails(
        '{"code":"publish_runtime_attempt_uncertain","details":"attempt-789"}'
      )
    ).toBe("attempt-789");
  });

  it("returns null for missing, empty, or malformed details", () => {
    expect(extractInvokeErrorDetails({ details: "   " })).toBeNull();
    expect(extractInvokeErrorDetails("{not valid json}")).toBeNull();
    expect(extractInvokeErrorDetails("plain failure")).toBeNull();
    expect(extractInvokeErrorDetails(null)).toBeNull();
  });
});

describe("analyzeBranchRefreshFailure", () => {
  it.each<[string, BranchRefreshFailureReason]>([
    ["path_not_found", "path_not_found"],
    ["not_directory", "not_directory"],
    ["git_missing", "git_missing"],
    ["cannot_connect_repo", "cannot_connect_repo"],
    ["not_git_repo", "not_git_repo"],
    ["permission_denied", "permission_denied"],
    ["dubious_ownership", "dubious_ownership"],
    ["no_branches", "no_branches"],
  ])("code %s 映射到 %s", (code, expected) => {
    expect(analyzeBranchRefreshFailure({ code })).toBe(expected);
  });

  it("中文子串『无法连接』命中 cannot_connect_repo", () => {
    expect(analyzeBranchRefreshFailure("无法连接远程仓库")).toBe(
      "cannot_connect_repo"
    );
  });

  it("中文子串『系统找不到指定的文件』配合 failed to execute git 命中 git_missing", () => {
    expect(
      analyzeBranchRefreshFailure("failed to execute git: 系统找不到指定的文件")
    ).toBe("git_missing");
  });

  it("中文子串『权限』命中 permission_denied", () => {
    expect(analyzeBranchRefreshFailure("读取目录时权限不足")).toBe(
      "permission_denied"
    );
  });

  it("英文子串 'not a git repository' 命中 not_git_repo", () => {
    expect(
      analyzeBranchRefreshFailure(
        "fatal: not a git repository (or any of the parent directories)"
      )
    ).toBe("not_git_repo");
  });

  it("无 code 且无子串命中时返回 unknown", () => {
    expect(analyzeBranchRefreshFailure("some totally novel failure")).toBe(
      "unknown"
    );
  });

  it("code 精确匹配优先于 message 子串", () => {
    expect(
      analyzeBranchRefreshFailure({
        code: "no_branches",
        message: "permission denied while reading",
      })
    ).toBe("no_branches");
  });
});

describe("analyzeProviderDetectFailure", () => {
  it.each<[string, ProviderDetectFailureReason]>([
    ["path_not_found", "path_not_found"],
    ["not_directory", "not_directory"],
    ["permission_denied", "permission_denied"],
    ["unsupported_provider", "unsupported_provider"],
    ["read_failed", "read_failed"],
  ])("code %s 映射到 %s", (code, expected) => {
    expect(analyzeProviderDetectFailure({ code })).toBe(expected);
  });

  it("中文子串『设备未就绪』命中 read_failed", () => {
    expect(analyzeProviderDetectFailure("读取失败：设备未就绪")).toBe(
      "read_failed"
    );
  });

  it("中文子串『权限』命中 permission_denied", () => {
    expect(analyzeProviderDetectFailure("访问目录时权限不足")).toBe(
      "permission_denied"
    );
  });

  it("英文子串 'cannot detect provider from repository path' 命中 unsupported_provider", () => {
    expect(
      analyzeProviderDetectFailure(
        "cannot detect provider from repository path"
      )
    ).toBe("unsupported_provider");
  });

  it("无 code 且无子串命中时返回 unknown", () => {
    expect(analyzeProviderDetectFailure("some totally novel failure")).toBe(
      "unknown"
    );
  });

  it("code 精确匹配优先于 message 子串", () => {
    expect(
      analyzeProviderDetectFailure({
        code: "read_failed",
        message: "permission denied",
      })
    ).toBe("read_failed");
  });
});

describe("analyzeProjectScanFailure", () => {
  it.each<[string, ProjectScanFailureReason]>([
    ["path_not_found", "path_not_found"],
    ["project_root_not_found", "project_root_not_found"],
    ["project_file_not_found", "project_file_not_found"],
    ["multiple_project_files_found", "multiple_project_files_found"],
    ["permission_denied", "permission_denied"],
    ["current_dir_failed", "current_dir_failed"],
  ])("code %s 映射到 %s", (code, expected) => {
    expect(analyzeProjectScanFailure({ code })).toBe(expected);
  });

  it("中文子串『访问被拒绝』命中 permission_denied", () => {
    expect(analyzeProjectScanFailure("扫描失败：访问被拒绝")).toBe(
      "permission_denied"
    );
  });

  it("中文子串『权限』命中 permission_denied", () => {
    expect(analyzeProjectScanFailure("扫描目录时权限不足")).toBe(
      "permission_denied"
    );
  });

  it("英文子串 'cannot find project root' 命中 project_root_not_found", () => {
    expect(
      analyzeProjectScanFailure("cannot find project root from scan path")
    ).toBe("project_root_not_found");
  });

  it("无 code 且无子串命中时返回 unknown", () => {
    expect(analyzeProjectScanFailure("some totally novel failure")).toBe(
      "unknown"
    );
  });

  it("code 精确匹配优先于 message 子串", () => {
    expect(
      analyzeProjectScanFailure({
        code: "current_dir_failed",
        message: "cannot find project root",
      })
    ).toBe("current_dir_failed");
  });
});

describe("analyzePublishExecutionFailure", () => {
  it.each<[string, PublishExecutionFailureReason]>([
    ["publish_already_running", "already_running"],
    ["project_path_not_found", "project_path_not_found"],
    ["publish_output_windows_drive_root_missing", "output_path_invalid"],
    ["publish_output_windows_style_path_on_posix", "output_path_incompatible"],
    [
      "publish_output_posix_absolute_path_on_windows",
      "output_path_incompatible",
    ],
    ["publish_output_path_incompatible", "output_path_incompatible"],
    [
      "publish_protected_directory_access_denied",
      "protected_directory_access_denied",
    ],
    ["publish_remote_target_not_implemented", "remote_target_not_implemented"],
    ["unsupported_provider", "unsupported_provider"],
    ["render_error", "render_error"],
    ["tool_missing", "tool_missing"],
    ["permission_denied", "permission_denied"],
    ["plan_missing_step", "plan_invalid"],
    ["plan_invalid_step_title", "plan_invalid"],
    ["java_project_dir_required", "plan_invalid"],
    ["java_gradle_not_found", "java_gradle_missing"],
    ["publish_spawn_failed", "process_failed"],
    ["publish_wait_failed", "process_failed"],
    ["publish_log_collect_failed", "process_failed"],
  ])("code %s 映射到 %s", (code, expected) => {
    expect(analyzePublishExecutionFailure({ code })).toBe(expected);
  });

  it("JSON string 形态的 invoke 错误也能提取 code 并分类", () => {
    expect(
      analyzePublishExecutionFailure(
        '{"code":"publish_already_running","message":"Another publish execution is already running"}'
      )
    ).toBe("already_running");
  });

  it("中文子串『权限』命中 permission_denied", () => {
    expect(analyzePublishExecutionFailure("写入输出目录时权限不足")).toBe(
      "permission_denied"
    );
  });

  it("中文子串『访问被拒绝』命中 permission_denied", () => {
    expect(analyzePublishExecutionFailure("发布失败：访问被拒绝")).toBe(
      "permission_denied"
    );
  });

  it("英文子串 'another publish execution is already running' 命中 already_running", () => {
    expect(
      analyzePublishExecutionFailure(
        "Another publish execution is already running"
      )
    ).toBe("already_running");
  });

  it("英文子串 'failed to spawn' + 'no such file or directory' 命中 tool_missing", () => {
    expect(
      analyzePublishExecutionFailure(
        "Failed to spawn dotnet: No such file or directory (os error 2)"
      )
    ).toBe("tool_missing");
  });

  it("无 code 且无子串命中时返回 unknown", () => {
    expect(analyzePublishExecutionFailure("some totally novel failure")).toBe(
      "unknown"
    );
  });

  it("code 精确匹配优先于 message 子串", () => {
    expect(
      analyzePublishExecutionFailure({
        code: "render_error",
        message: "another publish execution is already running",
      })
    ).toBe("render_error");
  });

  it("未识别的 code 不短路子串兜底", () => {
    // 现状钉板：code 存在但未匹配任何分支时，继续走 message 子串链。
    expect(
      analyzePublishExecutionFailure({
        code: "some_future_code",
        message: "another publish execution is already running",
      })
    ).toBe("already_running");
  });
});
