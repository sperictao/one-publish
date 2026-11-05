import type { TranslationMap } from "@/features/publish/publishTransaction";

// 取消路径后端真实发出的基础设施级错误（锁中毒/日志 IO）——
// 对用户而言这些细节是噪音，统一给"取消发送失败"的本地化描述；
// 语义型错误码（如 selector_invalid）保留后端原文更有信息量。
const CANCEL_INFRA_FAILURE_CODES = new Set([
  "publish_runtime_cancellation_poisoned",
  "publish_runtime_attempt_operation_poisoned",
  "publish_runtime_error",
]);

export function getCancelPublishFeedback(
  appT: TranslationMap,
  errorCode: string | null,
  errorMessage: string
): { title: string; description: string } {
  const title = appT.cancelPublishFailed || "取消发布失败";
  const fallbackDescription =
    appT.cancelPublishFailedDesc || "取消发送失败，请检查进程状态后重试。";

  if (errorCode !== null && CANCEL_INFRA_FAILURE_CODES.has(errorCode)) {
    return { title, description: fallbackDescription };
  }

  // 语义型错误保留后端原文，但 IPC 边界可能只给出空/空白消息；
  // 直接透传会让失败 toast 只剩标题，此时回退到通用的取消失败说明。
  // 非空白消息逐字保留（含首尾空格），不改变既有本地化行为。
  return {
    title,
    description:
      errorMessage.trim().length > 0 ? errorMessage : fallbackDescription,
  };
}
