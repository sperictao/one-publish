export interface FailureSignatureRecord {
  error?: string | null;
  commandLine?: string | null;
  failureSignature?: string | null;
  outputExcerpt?: string | null;
}

const SIGNATURE_MAX_LENGTH = 160;

export function extractFailureContext(output: string): string | null {
  const lines = output.split("\n").flatMap((line) => {
    const normalizedLine = line.trim();
    return normalizedLine ? [normalizedLine] : [];
  });

  const strongKeywordCandidate = lines.find((line) => {
    const normalized = line.toLowerCase();
    return normalized.includes("error") || normalized.includes("panic");
  });

  if (strongKeywordCandidate) {
    return strongKeywordCandidate;
  }

  const fallbackKeywordCandidate = lines.find((line) => {
    const normalized = line.toLowerCase();
    return normalized.includes("exception") || normalized.includes("failed");
  });

  if (fallbackKeywordCandidate) {
    return fallbackKeywordCandidate;
  }

  return lines.find((line) => line.startsWith("[stderr]")) || null;
}

export function normalizeFailureSignature(raw: string): string {
  const truncated = raw
    .trim()
    .toLowerCase()
    .replace(/[a-z]:[\\/][^\s"'`]+/gi, "<path>")
    .replace(/(?:\/[^/\s"'`]+){2,}/g, "<path>")
    .replace(/0x[0-9a-f]+/gi, "<hex>")
    .replace(/\b\d+\b/g, "<num>")
    .replace(/["'`][^"'`]+["'`]/g, "<value>")
    .replace(/\s+/g, " ")
    .slice(0, SIGNATURE_MAX_LENGTH);

  // String#slice 以 UTF-16 码元计数，160 的截断点可能落在一对代理项中间（如
  // emoji），使签名以孤立的高位代理项结尾（buildOutputExcerpt 从尾部截断，
  // 遇到的是开头孤立低位代理项，方向相反）。JSON.stringify 会把它写成
  // "\udXXX" 转义，经 IPC 交给 Rust serde_json 时不是合法 Unicode 标量值，
  // UI 与诊断导出也会显示成替换字符。若末位是高位代理项则去掉该码元，保证
  // 签名始终是合法 UTF-16；完整位于截断范围内的代理对不受影响，长度仍不超上限。
  const lastCodeUnit = truncated.charCodeAt(truncated.length - 1);
  if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) {
    return truncated.slice(0, -1).trim();
  }

  return truncated.trim();
}

export function deriveFailureSignature(params: {
  error?: string | null;
  output?: string;
}): string | null {
  const raw =
    params.error?.trim() ||
    (params.output ? extractFailureContext(params.output) : null) ||
    null;

  if (!raw) {
    return null;
  }

  const normalized = normalizeFailureSignature(raw);
  return normalized || null;
}

export function resolveFailureSignature(
  record: FailureSignatureRecord
): string | null {
  if (
    typeof record.failureSignature === "string" &&
    record.failureSignature.trim().length > 0
  ) {
    return record.failureSignature.trim();
  }

  // 旧记录可能没有持久化 failureSignature。此时应从已保存的日志摘要里找错误行，
  // 命令行只是显示用的 "$ ..."，不是错误日志，单独传进去永远匹配不到 error/panic 关键字。
  // 没有摘要的更早期记录仍回退到命令行，保持原行为。
  const output = record.outputExcerpt?.trim()
    ? record.outputExcerpt
    : (record.commandLine ?? "");

  return deriveFailureSignature({
    error: record.error,
    output,
  });
}
