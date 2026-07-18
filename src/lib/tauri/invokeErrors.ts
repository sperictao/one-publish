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

interface MessageRule<Reason extends string> {
  reason: Reason;
  /** Every listed substring must appear in the normalized message. */
  all?: string[];
  /** At least one listed substring must appear in the normalized message. */
  any?: string[];
}

const SHARED_REPOSITORY_PATH_NOT_FOUND_RULE: MessageRule<"path_not_found"> = {
  reason: "path_not_found",
  any: ["repository path does not exist"],
};

const SHARED_REPOSITORY_PATH_NOT_DIRECTORY_RULE: MessageRule<"not_directory"> = {
  reason: "not_directory",
  any: ["repository path is not a directory"],
};

const SHARED_PERMISSION_DENIED_RULE: MessageRule<"permission_denied"> = {
  reason: "permission_denied",
  any: [
    "permission denied",
    "operation not permitted",
    "访问被拒绝",
    "权限",
  ],
};

function matchesMessageRule<Reason extends string>(
  normalized: string,
  rule: MessageRule<Reason>
): boolean {
  if (rule.all && !rule.all.every((pattern) => normalized.includes(pattern))) {
    return false;
  }

  if (rule.any && !rule.any.some((pattern) => normalized.includes(pattern))) {
    return false;
  }

  return true;
}

function classifyInvokeFailure<Reason extends string>(
  error: unknown,
  codeReasons: Record<string, Reason>,
  messageRules: ReadonlyArray<MessageRule<Reason>>,
  fallback: Reason
): Reason {
  const errorCode = extractInvokeErrorCode(error);
  if (
    errorCode &&
    Object.prototype.hasOwnProperty.call(codeReasons, errorCode)
  ) {
    return codeReasons[errorCode];
  }

  const normalized = extractInvokeErrorMessage(error).toLowerCase();
  for (const rule of messageRules) {
    if (matchesMessageRule(normalized, rule)) {
      return rule.reason;
    }
  }

  return fallback;
}

const BRANCH_REFRESH_CODE_REASONS: Record<string, BranchRefreshFailureReason> = {
  path_not_found: "path_not_found",
  not_directory: "not_directory",
  git_missing: "git_missing",
  cannot_connect_repo: "cannot_connect_repo",
  not_git_repo: "not_git_repo",
  permission_denied: "permission_denied",
  dubious_ownership: "dubious_ownership",
  no_branches: "no_branches",
};

const BRANCH_REFRESH_MESSAGE_RULES: ReadonlyArray<
  MessageRule<BranchRefreshFailureReason>
> = [
  SHARED_REPOSITORY_PATH_NOT_FOUND_RULE,
  SHARED_REPOSITORY_PATH_NOT_DIRECTORY_RULE,
  {
    reason: "git_missing",
    all: ["failed to execute git"],
    any: [
      "no such file or directory",
      "os error 2",
      "系统找不到指定的文件",
    ],
  },
  {
    reason: "cannot_connect_repo",
    any: [
      "unable to access",
      "failed to connect",
      "could not resolve host",
      "connection timed out",
      "connection refused",
      "unable to connect",
      "unable to look up",
      "couldn't connect to server",
      "network is unreachable",
      "could not read from remote repository",
      "could not read username",
      "authentication failed",
      "publickey",
      "repository not found",
      "proxy connect aborted",
      "无法连接",
      "连接超时",
      "连接被拒绝",
      "无法访问远程仓库",
      "无法从远程仓库读取",
      "无法解析主机",
      "网络不可达",
    ],
  },
  {
    reason: "not_git_repo",
    any: ["not a git repository", "不是 git 仓库", "不是一个git仓库"],
  },
  { reason: "dubious_ownership", any: ["detected dubious ownership"] },
  SHARED_PERMISSION_DENIED_RULE,
  { reason: "no_branches", any: ["no git branches found"] },
];

export function analyzeBranchRefreshFailure(
  error: unknown
): BranchRefreshFailureReason {
  return classifyInvokeFailure(
    error,
    BRANCH_REFRESH_CODE_REASONS,
    BRANCH_REFRESH_MESSAGE_RULES,
    "unknown"
  );
}

export type ProviderDetectFailureReason =
  | "path_not_found"
  | "not_directory"
  | "permission_denied"
  | "unsupported_provider"
  | "read_failed"
  | "unknown";

const PROVIDER_DETECT_CODE_REASONS: Record<string, ProviderDetectFailureReason> = {
  path_not_found: "path_not_found",
  not_directory: "not_directory",
  permission_denied: "permission_denied",
  unsupported_provider: "unsupported_provider",
  read_failed: "read_failed",
};

const PROVIDER_DETECT_MESSAGE_RULES: ReadonlyArray<
  MessageRule<ProviderDetectFailureReason>
> = [
  SHARED_REPOSITORY_PATH_NOT_FOUND_RULE,
  SHARED_REPOSITORY_PATH_NOT_DIRECTORY_RULE,
  SHARED_PERMISSION_DENIED_RULE,
  { reason: "permission_denied", any: ["无权限"] },
  {
    reason: "unsupported_provider",
    any: ["cannot detect provider from repository path"],
  },
  {
    reason: "read_failed",
    any: [
      "failed to read repository directory",
      "input/output error",
      "i/o error",
      "设备未就绪",
    ],
  },
];

export function analyzeProviderDetectFailure(
  error: unknown
): ProviderDetectFailureReason {
  return classifyInvokeFailure(
    error,
    PROVIDER_DETECT_CODE_REASONS,
    PROVIDER_DETECT_MESSAGE_RULES,
    "unknown"
  );
}

export type ProjectScanFailureReason =
  | "path_not_found"
  | "project_root_not_found"
  | "project_file_not_found"
  | "multiple_project_files_found"
  | "permission_denied"
  | "current_dir_failed"
  | "unknown";

const PROJECT_SCAN_CODE_REASONS: Record<string, ProjectScanFailureReason> = {
  path_not_found: "path_not_found",
  project_root_not_found: "project_root_not_found",
  project_file_not_found: "project_file_not_found",
  multiple_project_files_found: "multiple_project_files_found",
  permission_denied: "permission_denied",
  current_dir_failed: "current_dir_failed",
};

const PROJECT_SCAN_MESSAGE_RULES: ReadonlyArray<
  MessageRule<ProjectScanFailureReason>
> = [
  { reason: "path_not_found", any: ["scan start path does not exist"] },
  { reason: "project_root_not_found", any: ["cannot find project root"] },
  { reason: "project_file_not_found", any: ["cannot find project file"] },
  {
    reason: "multiple_project_files_found",
    any: ["multiple project files found"],
  },
  SHARED_PERMISSION_DENIED_RULE,
  { reason: "current_dir_failed", any: ["failed to resolve current directory"] },
];

export function analyzeProjectScanFailure(
  error: unknown
): ProjectScanFailureReason {
  return classifyInvokeFailure(
    error,
    PROJECT_SCAN_CODE_REASONS,
    PROJECT_SCAN_MESSAGE_RULES,
    "unknown"
  );
}

export type PublishExecutionFailureReason =
  | "already_running"
  | "project_path_not_found"
  | "output_path_invalid"
  | "output_path_incompatible"
  | "protected_directory_access_denied"
  | "remote_target_not_implemented"
  | "unsupported_provider"
  | "render_error"
  | "tool_missing"
  | "permission_denied"
  | "plan_invalid"
  | "java_gradle_missing"
  | "process_failed"
  | "unknown";

const PUBLISH_EXECUTION_CODE_REASONS: Record<
  string,
  PublishExecutionFailureReason
> = {
  publish_already_running: "already_running",
  project_path_not_found: "project_path_not_found",
  publish_output_windows_drive_root_missing: "output_path_invalid",
  publish_output_windows_style_path_on_posix: "output_path_incompatible",
  publish_output_posix_absolute_path_on_windows: "output_path_incompatible",
  publish_output_path_incompatible: "output_path_incompatible",
  publish_protected_directory_access_denied:
    "protected_directory_access_denied",
  publish_remote_target_not_implemented: "remote_target_not_implemented",
  unsupported_provider: "unsupported_provider",
  render_error: "render_error",
  tool_missing: "tool_missing",
  permission_denied: "permission_denied",
  plan_missing_step: "plan_invalid",
  plan_invalid_step_title: "plan_invalid",
  java_project_dir_required: "plan_invalid",
  java_gradle_not_found: "java_gradle_missing",
  publish_spawn_failed: "process_failed",
  publish_wait_failed: "process_failed",
  publish_log_collect_failed: "process_failed",
};

const PUBLISH_EXECUTION_MESSAGE_RULES: ReadonlyArray<
  MessageRule<PublishExecutionFailureReason>
> = [
  {
    reason: "already_running",
    any: ["another publish execution is already running"],
  },
  { reason: "project_path_not_found", any: ["project path does not exist"] },
  {
    reason: "output_path_invalid",
    any: ["missing windows drive or share root"],
  },
  {
    reason: "output_path_incompatible",
    any: ["publish output path is incompatible with this system"],
  },
  {
    reason: "protected_directory_access_denied",
    any: ["publish output directory requires macos protected folder access"],
  },
  {
    reason: "remote_target_not_implemented",
    any: ["remote publish target is not implemented yet"],
  },
  { reason: "unsupported_provider", any: ["unsupported provider"] },
  { reason: "render_error", any: ["parameter render error"] },
  {
    reason: "tool_missing",
    all: ["failed to spawn"],
    any: ["no such file or directory", "os error 2"],
  },
  SHARED_PERMISSION_DENIED_RULE,
  {
    reason: "plan_invalid",
    any: ["execution plan has no step", "execution step title is empty"],
  },
  {
    reason: "java_gradle_missing",
    any: ["gradle wrapper not found", "java provider requires a project directory"],
  },
  {
    reason: "process_failed",
    any: [
      "failed to spawn",
      "failed to wait publish process",
      "failed to collect publish logs",
    ],
  },
];

export function analyzePublishExecutionFailure(
  error: unknown
): PublishExecutionFailureReason {
  return classifyInvokeFailure(
    error,
    PUBLISH_EXECUTION_CODE_REASONS,
    PUBLISH_EXECUTION_MESSAGE_RULES,
    "unknown"
  );
}
