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

  // 与 buildOutputExcerpt 一致地按 CRLF/LF 切行：Windows 日志用 "\n" 切分
  // 会把行尾 \r 留在 commandLine 里，污染持久化的历史记录与诊断导出。
  for (const line of outputLog.split(/\r?\n/)) {
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

  let start = excerpt.length - OUTPUT_EXCERPT_MAX_CHARS;
  // String#slice 以 UTF-16 码元计数，截断点可能落在一对代理项中间（如 emoji），
  // 使摘录以孤立的低位代理项开头。JSON.stringify 会把它写成 "\udXXX" 转义，
  // 经 IPC 交给 Rust serde_json 时不是合法 Unicode 标量值，UI 与诊断导出也会
  // 显示成替换字符。若起点是低位代理项则后移一个码元，保证摘录始终是合法
  // UTF-16；完整位于摘录内的代理对不受影响，长度仍不超过上限。
  if (
    excerpt.charCodeAt(start) >= 0xdc00 &&
    excerpt.charCodeAt(start) <= 0xdfff
  ) {
    start += 1;
  }

  return excerpt.slice(start);
}

function toStoredSpecValue(spec: ProviderPublishSpec): JsonValue {
  return structuredClone(spec) as JsonValue;
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
  /** Attempt 封存的 Artifact Manifest 摘要；供 Promotion 再交付引用。 */
  manifestDigest?: string | null;
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
    manifestDigest: params.manifestDigest ?? undefined,
    recoverySnapshot: params.recoverySnapshot,
    fileCount: params.result.file_count,
    warnings: params.result.warnings ?? null,
  };
}
