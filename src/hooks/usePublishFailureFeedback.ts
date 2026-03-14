interface TranslationMap {
  [key: string]: string | undefined;
}

export function getPublishFailureFeedback(
  failureReason: string | null,
  appT: TranslationMap,
  rawErrorMessage: string
): { title: string; description: string } {
  if (failureReason === "already_running") {
    return {
      title: appT.publishAlreadyRunning || "已有发布任务正在执行",
      description:
        appT.publishAlreadyRunningDesc ||
        "请等待当前任务结束，或先取消后再重试。",
    };
  }

  if (failureReason === "project_path_not_found") {
    return {
      title: appT.publishProjectPathNotFound || "项目路径不存在",
      description:
        appT.publishProjectPathNotFoundDesc ||
        "请确认 Project Root / Project File 路径正确后重试。",
    };
  }

  if (failureReason === "unsupported_provider") {
    return {
      title: appT.publishProviderUnsupported || "不支持的 Provider",
      description:
        appT.publishProviderUnsupportedDesc ||
        "请确认 Provider 配置有效，或在编辑弹窗重新选择 Provider。",
    };
  }

  if (failureReason === "render_error") {
    return {
      title: appT.publishRenderFailed || "参数渲染失败",
      description:
        appT.publishRenderFailedDesc ||
        "请检查当前参数配置是否符合 Provider 要求。",
    };
  }

  if (failureReason === "tool_missing") {
    return {
      title: appT.publishToolMissing || "缺少构建命令",
      description:
        appT.publishToolMissingDesc ||
        "请安装对应构建工具，并确保命令已加入 PATH。",
    };
  }

  if (failureReason === "permission_denied") {
    return {
      title: appT.publishPermissionDenied || "缺少执行权限",
      description:
        appT.publishPermissionDeniedDesc ||
        "请检查项目目录与构建命令的执行权限后重试。",
    };
  }

  if (failureReason === "plan_invalid") {
    return {
      title: appT.publishPlanInvalid || "发布计划无效",
      description:
        appT.publishPlanInvalidDesc ||
        "当前发布命令计划不可执行，请检查 Provider 与参数。",
    };
  }

  if (failureReason === "java_gradle_missing") {
    return {
      title: appT.publishGradleMissing || "未检测到 Gradle",
      description:
        appT.publishGradleMissingDesc ||
        "请确保项目下存在 gradlew，或在环境中安装 gradle。",
    };
  }

  if (failureReason === "process_failed") {
    return {
      title: appT.publishProcessFailed || "发布进程执行失败",
      description:
        appT.publishProcessFailedDesc ||
        "发布进程启动或等待失败，请稍后重试。",
    };
  }

  return {
    title: appT.publishExecutionError || "发布执行错误",
    description: rawErrorMessage,
  };
}
