import type { PublishResult } from "@/generated/tauri-contracts";
import { extractFailureContext } from "@/features/history/failureSignature";

const GENERIC_PUBLISH_FAILURE_PATTERNS = [
  /(?:^发布失败|^publish failed|^process failed).*(?:退出代码|exit code)/i,
  /(?:退出代码|exit code)\s*[:：]?\s*some\(\d+\)/i,
];
const MACOS_PROTECTED_OUTPUT_PATH_PATTERN =
  /\/Users\/[^"'\s]+\/(?:Downloads|Desktop|Documents)(?:\/[^"'\r\n]*)?/i;

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

export function isProtectedOutputAccessFailure(params: {
  error?: string | null;
  outputLog?: string | null;
}): boolean {
  const message = [params.error, params.outputLog]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join("\n");

  if (!MACOS_PROTECTED_OUTPUT_PATH_PATTERN.test(message)) {
    return false;
  }

  const normalized = message.toLowerCase();
  return (
    normalized.includes("operation not permitted") ||
    normalized.includes("permission denied") ||
    (normalized.includes("access to the path") &&
      normalized.includes("is denied")) ||
    (normalized.includes("msb3021") &&
      normalized.includes("access") &&
      normalized.includes("denied"))
  );
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
