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

  for (const line of outputLog.split("\n")) {
    if (line.startsWith("$ ")) {
      return line;
    }
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
  /** prepare ready 产出的 resolvedSpec；准备失败/被阻断的早期失败为 null。 */
  spec: ProviderPublishSpec | null;
  /** spec 缺失时的 provider 回退（来源自带的 providerId）。 */
  providerId?: string;
  repoId: string | null;
  configurationId?: string | null;
  configurationRevisionId?: string | null;
  /** 关联的运行时 Attempt；start 之前失败的记录为空。 */
  attemptId?: string;
  /** prepare ready 携带的版本化恢复快照（§3.3）。 */
  recoverySnapshot?: JsonValue;
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
    configurationId: params.configurationId ?? null,
    configurationRevisionId: params.configurationRevisionId ?? null,
    providerId: params.spec?.provider_id ?? params.providerId ?? "",
    projectPath: params.spec?.project_path ?? "",
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
    spec: params.spec ? toStoredSpecValue(params.spec) : null,
    attemptId: params.attemptId,
    recoverySnapshot: params.recoverySnapshot,
    fileCount: params.result.file_count,
    warnings: params.result.warnings ?? null,
  };
}
