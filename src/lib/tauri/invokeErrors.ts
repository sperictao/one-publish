export type BranchRefreshFailureReason =
  | "path_not_found"
  | "not_directory"
  | "git_missing"
  | "cannot_connect_repo"
  | "not_git_repo"
  | "permission_denied"
  | "dubious_ownership"
  | "no_branches"
  | "unknown";

export function extractInvokeErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error === "object") {
    const payload = error as {
      message?: unknown;
      details?: unknown;
      error?: unknown;
    };

    const parts = [payload.message, payload.details, payload.error]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
      .map((part) => part.trim());

    if (parts.length > 0) {
      return parts.join(" | ");
    }

    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  return String(error);
}

export function extractInvokeErrorCode(error: unknown): string | null {
  const extractCodeFromObject = (value: unknown): string | null => {
    if (!value || typeof value !== "object") {
      return null;
    }

    const payload = value as {
      code?: unknown;
      data?: unknown;
      details?: unknown;
    };

    if (typeof payload.code === "string" && payload.code.trim().length > 0) {
      return payload.code.trim().toLowerCase();
    }

    if (payload.data && typeof payload.data === "object") {
      const nestedCode = (payload.data as { code?: unknown }).code;
      if (typeof nestedCode === "string" && nestedCode.trim().length > 0) {
        return nestedCode.trim().toLowerCase();
      }
    }

    if (payload.details && typeof payload.details === "object") {
      const nestedCode = (payload.details as { code?: unknown }).code;
      if (typeof nestedCode === "string" && nestedCode.trim().length > 0) {
        return nestedCode.trim().toLowerCase();
      }
    }

    return null;
  };

  if (typeof error === "string") {
    const trimmed = error.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        return extractCodeFromObject(JSON.parse(trimmed));
      } catch {
        return null;
      }
    }

    return null;
  }

  return extractCodeFromObject(error);
}

export function analyzeBranchRefreshFailure(
  error: unknown
): BranchRefreshFailureReason {
  const errorCode = extractInvokeErrorCode(error);
  if (errorCode) {
    if (errorCode === "path_not_found") {
      return "path_not_found";
    }

    if (errorCode === "not_directory") {
      return "not_directory";
    }

    if (errorCode === "git_missing") {
      return "git_missing";
    }

    if (errorCode === "cannot_connect_repo") {
      return "cannot_connect_repo";
    }

    if (errorCode === "not_git_repo") {
      return "not_git_repo";
    }

    if (errorCode === "permission_denied") {
      return "permission_denied";
    }

    if (errorCode === "dubious_ownership") {
      return "dubious_ownership";
    }

    if (errorCode === "no_branches") {
      return "no_branches";
    }
  }

  const normalized = extractInvokeErrorMessage(error).toLowerCase();

  if (normalized.includes("repository path does not exist")) {
    return "path_not_found";
  }

  if (normalized.includes("repository path is not a directory")) {
    return "not_directory";
  }

  if (
    normalized.includes("failed to execute git") &&
    (normalized.includes("no such file or directory") ||
      normalized.includes("os error 2") ||
      normalized.includes("系统找不到指定的文件"))
  ) {
    return "git_missing";
  }

  if (
    normalized.includes("unable to access") ||
    normalized.includes("failed to connect") ||
    normalized.includes("could not resolve host") ||
    normalized.includes("connection timed out") ||
    normalized.includes("connection refused") ||
    normalized.includes("unable to connect") ||
    normalized.includes("unable to look up") ||
    normalized.includes("couldn't connect to server") ||
    normalized.includes("network is unreachable") ||
    normalized.includes("could not read from remote repository") ||
    normalized.includes("could not read username") ||
    normalized.includes("authentication failed") ||
    normalized.includes("publickey") ||
    normalized.includes("repository not found") ||
    normalized.includes("proxy connect aborted") ||
    normalized.includes("无法连接") ||
    normalized.includes("连接超时") ||
    normalized.includes("连接被拒绝") ||
    normalized.includes("无法访问远程仓库") ||
    normalized.includes("无法从远程仓库读取") ||
    normalized.includes("无法解析主机") ||
    normalized.includes("网络不可达")
  ) {
    return "cannot_connect_repo";
  }

  if (
    normalized.includes("not a git repository") ||
    normalized.includes("不是 git 仓库") ||
    normalized.includes("不是一个git仓库")
  ) {
    return "not_git_repo";
  }

  if (normalized.includes("detected dubious ownership")) {
    return "dubious_ownership";
  }

  if (
    normalized.includes("permission denied") ||
    normalized.includes("operation not permitted") ||
    normalized.includes("访问被拒绝") ||
    normalized.includes("权限")
  ) {
    return "permission_denied";
  }

  if (normalized.includes("no git branches found")) {
    return "no_branches";
  }

  return "unknown";
}

export type ProviderDetectFailureReason =
  | "path_not_found"
  | "not_directory"
  | "permission_denied"
  | "unsupported_provider"
  | "read_failed"
  | "unknown";

export function analyzeProviderDetectFailure(
  error: unknown
): ProviderDetectFailureReason {
  const errorCode = extractInvokeErrorCode(error);
  if (errorCode) {
    if (errorCode === "path_not_found") {
      return "path_not_found";
    }

    if (errorCode === "not_directory") {
      return "not_directory";
    }

    if (errorCode === "permission_denied") {
      return "permission_denied";
    }

    if (errorCode === "unsupported_provider") {
      return "unsupported_provider";
    }

    if (errorCode === "read_failed") {
      return "read_failed";
    }
  }

  const normalized = extractInvokeErrorMessage(error).toLowerCase();

  if (normalized.includes("repository path does not exist")) {
    return "path_not_found";
  }

  if (normalized.includes("repository path is not a directory")) {
    return "not_directory";
  }

  if (
    normalized.includes("permission denied") ||
    normalized.includes("operation not permitted") ||
    normalized.includes("访问被拒绝") ||
    normalized.includes("无权限") ||
    normalized.includes("权限")
  ) {
    return "permission_denied";
  }

  if (normalized.includes("cannot detect provider from repository path")) {
    return "unsupported_provider";
  }

  if (
    normalized.includes("failed to read repository directory") ||
    normalized.includes("input/output error") ||
    normalized.includes("i/o error") ||
    normalized.includes("设备未就绪")
  ) {
    return "read_failed";
  }

  return "unknown";
}

export type ProjectScanFailureReason =
  | "path_not_found"
  | "project_root_not_found"
  | "project_file_not_found"
  | "permission_denied"
  | "current_dir_failed"
  | "unknown";

export function analyzeProjectScanFailure(
  error: unknown
): ProjectScanFailureReason {
  const errorCode = extractInvokeErrorCode(error);
  if (errorCode) {
    if (errorCode === "path_not_found") {
      return "path_not_found";
    }

    if (errorCode === "project_root_not_found") {
      return "project_root_not_found";
    }

    if (errorCode === "project_file_not_found") {
      return "project_file_not_found";
    }

    if (errorCode === "permission_denied") {
      return "permission_denied";
    }

    if (errorCode === "current_dir_failed") {
      return "current_dir_failed";
    }
  }

  const normalized = extractInvokeErrorMessage(error).toLowerCase();

  if (normalized.includes("scan start path does not exist")) {
    return "path_not_found";
  }

  if (normalized.includes("cannot find project root")) {
    return "project_root_not_found";
  }

  if (normalized.includes("cannot find project file")) {
    return "project_file_not_found";
  }

  if (
    normalized.includes("permission denied") ||
    normalized.includes("operation not permitted") ||
    normalized.includes("访问被拒绝") ||
    normalized.includes("权限")
  ) {
    return "permission_denied";
  }

  if (normalized.includes("failed to resolve current directory")) {
    return "current_dir_failed";
  }

  return "unknown";
}

export type PublishExecutionFailureReason =
  | "already_running"
  | "project_path_not_found"
  | "unsupported_provider"
  | "render_error"
  | "tool_missing"
  | "permission_denied"
  | "plan_invalid"
  | "java_gradle_missing"
  | "process_failed"
  | "unknown";

export function analyzePublishExecutionFailure(
  error: unknown
): PublishExecutionFailureReason {
  const errorCode = extractInvokeErrorCode(error);
  if (errorCode) {
    if (errorCode === "publish_already_running") {
      return "already_running";
    }

    if (errorCode === "project_path_not_found") {
      return "project_path_not_found";
    }

    if (errorCode === "unsupported_provider") {
      return "unsupported_provider";
    }

    if (errorCode === "render_error") {
      return "render_error";
    }

    if (errorCode === "tool_missing") {
      return "tool_missing";
    }

    if (errorCode === "permission_denied") {
      return "permission_denied";
    }

    if (
      errorCode === "plan_missing_step" ||
      errorCode === "plan_invalid_step_title" ||
      errorCode === "java_project_dir_required"
    ) {
      return "plan_invalid";
    }

    if (errorCode === "java_gradle_not_found") {
      return "java_gradle_missing";
    }

    if (
      errorCode === "publish_spawn_failed" ||
      errorCode === "publish_wait_failed" ||
      errorCode === "publish_log_collect_failed"
    ) {
      return "process_failed";
    }
  }

  const normalized = extractInvokeErrorMessage(error).toLowerCase();

  if (normalized.includes("another publish execution is already running")) {
    return "already_running";
  }

  if (normalized.includes("project path does not exist")) {
    return "project_path_not_found";
  }

  if (normalized.includes("unsupported provider")) {
    return "unsupported_provider";
  }

  if (normalized.includes("parameter render error")) {
    return "render_error";
  }

  if (
    normalized.includes("failed to spawn") &&
    (normalized.includes("no such file or directory") || normalized.includes("os error 2"))
  ) {
    return "tool_missing";
  }

  if (
    normalized.includes("permission denied") ||
    normalized.includes("operation not permitted") ||
    normalized.includes("访问被拒绝") ||
    normalized.includes("权限")
  ) {
    return "permission_denied";
  }

  if (
    normalized.includes("execution plan has no step") ||
    normalized.includes("execution step title is empty")
  ) {
    return "plan_invalid";
  }

  if (
    normalized.includes("gradle wrapper not found") ||
    normalized.includes("java provider requires a project directory")
  ) {
    return "java_gradle_missing";
  }

  if (
    normalized.includes("failed to spawn") ||
    normalized.includes("failed to wait publish process") ||
    normalized.includes("failed to collect publish logs")
  ) {
    return "process_failed";
  }

  return "unknown";
}
