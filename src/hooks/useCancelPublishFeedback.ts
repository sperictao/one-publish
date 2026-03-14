import type { TranslationMap } from "@/hooks/usePublishExecutionTypes";

export function getCancelPublishFeedback(
  appT: TranslationMap,
  errorCode: string | null,
  rawErrorMessage: string
): { title: string; description: string } {
  if (errorCode === "publish_cancel_failed") {
    return {
      title: appT.cancelPublishFailed || "取消发布失败",
      description:
        appT.cancelPublishFailedDesc ||
        "取消信号发送失败，请检查进程状态后重试。",
    };
  }

  return {
    title: appT.cancelPublishFailed || "取消发布失败",
    description: rawErrorMessage,
  };
}
