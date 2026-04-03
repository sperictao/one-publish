import type { PublishResult } from "@/generated/tauri-contracts";
import { extractFailureContext } from "@/lib/failureSignature";

const GENERIC_PUBLISH_FAILURE_PATTERNS = [
  /(?:^发布失败|^publish failed|^process failed).*(?:退出代码|exit code)/i,
  /(?:退出代码|exit code)\s*[:：]?\s*some\(\d+\)/i,
];

export function isGenericPublishFailureMessage(message: string): boolean {
  const normalizedMessage = message.trim();
  return GENERIC_PUBLISH_FAILURE_PATTERNS.some((pattern) =>
    pattern.test(normalizedMessage)
  );
}

export function resolvePublishFailureMessage(params: {
  error?: string | null;
  outputLog?: string;
}): string | null {
  const error = params.error?.trim() || null;
  const outputContext = params.outputLog
    ? extractFailureContext(params.outputLog)
    : null;

  if (outputContext && (!error || isGenericPublishFailureMessage(error))) {
    return outputContext;
  }

  return error || outputContext || null;
}

export function normalizePublishResult<T extends PublishResult>(params: {
  result: T;
  outputLog: string;
}): T {
  if (params.result.success || params.result.cancelled) {
    return params.result;
  }

  const resolvedError = resolvePublishFailureMessage({
    error: params.result.error,
    outputLog: params.outputLog,
  });

  if (resolvedError === params.result.error) {
    return params.result;
  }

  return {
    ...params.result,
    error: resolvedError,
  };
}
