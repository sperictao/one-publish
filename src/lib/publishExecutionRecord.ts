import { deriveFailureSignature } from "@/lib/failureSignature";
import type { ExecutionRecord, JsonValue } from "@/lib/store";
import type {
  ProviderPublishSpec,
  PublishResult,
} from "@/hooks/usePublishRunner";

function extractCommandLine(outputLog: string): string | null {
  if (!outputLog) {
    return null;
  }

  let cursor = 0;
  while (cursor < outputLog.length) {
    const nextBreak = outputLog.indexOf("\n", cursor);
    const line =
      nextBreak === -1
        ? outputLog.slice(cursor)
        : outputLog.slice(cursor, nextBreak);

    if (line.startsWith("$ ")) {
      return line;
    }

    if (nextBreak === -1) {
      break;
    }

    cursor = nextBreak + 1;
  }

  return null;
}

function toStoredSpecValue(spec: ProviderPublishSpec): JsonValue {
  return JSON.parse(JSON.stringify(spec)) as JsonValue;
}

export function createPublishExecutionRecord(params: {
  spec: ProviderPublishSpec;
  repoId: string | null;
  startedAt: string;
  finishedAt: string;
  result: PublishResult;
  outputLog: string;
}): ExecutionRecord {
  const commandLine = extractCommandLine(params.outputLog);
  const failureSignature =
    !params.result.success && !params.result.cancelled
      ? deriveFailureSignature({
          error: params.result.error,
          output: params.outputLog,
        })
      : null;

  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    repoId: params.repoId,
    providerId: params.spec.provider_id,
    projectPath: params.spec.project_path,
    startedAt: params.startedAt,
    finishedAt: params.finishedAt,
    success: params.result.success,
    cancelled: params.result.cancelled,
    outputDir: params.result.output_dir || null,
    error: params.result.error,
    commandLine,
    snapshotPath: null,
    failureSignature,
    spec: toStoredSpecValue(params.spec),
    fileCount: params.result.file_count,
  };
}
