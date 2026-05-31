import { deriveFailureSignature } from "@/features/history/failureSignature";
import type { ExecutionRecord, JsonValue } from "@/lib/store/types";
import type {
  ProviderPublishSpec,
  PublishResult,
} from "@/features/publish/publishRuntime";

const OUTPUT_EXCERPT_MAX_LINES = 40;
const OUTPUT_EXCERPT_MAX_CHARS = 16_000;

function extractCommandLine(
  result: PublishResult,
  outputLog: string
): string | null {
  if (result.command?.display_command?.trim()) {
    return `$ ${result.command.display_command.trim()}`;
  }

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

function buildOutputExcerpt(outputLog: string): string | null {
  if (!outputLog.trim()) {
    return null;
  }

  const lines = outputLog
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(-OUTPUT_EXCERPT_MAX_LINES);
  if (lines.length === 0) {
    return null;
  }

  const excerpt = lines.join("\n");
  if (excerpt.length <= OUTPUT_EXCERPT_MAX_CHARS) {
    return excerpt;
  }

  return excerpt.slice(excerpt.length - OUTPUT_EXCERPT_MAX_CHARS);
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
  const commandLine = extractCommandLine(params.result, params.outputLog);
  const failureSignature =
    !params.result.success && !params.result.cancelled
      ? deriveFailureSignature({
          error: params.result.error,
          output: params.outputLog,
        })
      : null;
  const outputExcerpt =
    !params.result.success && !params.result.cancelled
      ? buildOutputExcerpt(params.outputLog)
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
    outputExcerpt,
    spec: toStoredSpecValue(params.spec),
    fileCount: params.result.file_count,
  };
}
