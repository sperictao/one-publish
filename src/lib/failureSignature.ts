export interface FailureSignatureRecord {
  error?: string | null;
  commandLine?: string | null;
  failureSignature?: string | null;
}

const SIGNATURE_MAX_LENGTH = 160;

export function extractFailureContext(output: string): string | null {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const keywordCandidate = lines.find((line) => {
    const normalized = line.toLowerCase();
    return (
      normalized.includes("error") ||
      normalized.includes("exception") ||
      normalized.includes("failed") ||
      normalized.includes("panic")
    );
  });

  if (keywordCandidate) {
    return keywordCandidate;
  }

  return lines.find((line) => line.startsWith("[stderr]")) || null;
}

export function normalizeFailureSignature(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[a-z]:[\\/][^\s"'`]+/gi, "<path>")
    .replace(/(?:\/[^\/\s"'`]+){2,}/g, "<path>")
    .replace(/0x[0-9a-f]+/gi, "<hex>")
    .replace(/\b\d+\b/g, "<num>")
    .replace(/["'`][^"'`]+["'`]/g, "<value>")
    .replace(/\s+/g, " ")
    .slice(0, SIGNATURE_MAX_LENGTH)
    .trim();
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

  return deriveFailureSignature({
    error: record.error,
    output: record.commandLine || "",
  });
}
