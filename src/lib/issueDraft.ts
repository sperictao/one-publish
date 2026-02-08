export interface FailureIssueRecord {
  id: string;
  finishedAt: string;
  projectPath: string;
  error?: string | null;
  commandLine?: string | null;
  snapshotPath?: string | null;
  outputDir?: string | null;
}

export interface FailureIssueDraftParams {
  providerId: string;
  signature: string;
  frequency: number;
  representativeCommand?: string | null;
  records: FailureIssueRecord[];
}

function formatSnapshotRef(record: FailureIssueRecord): string {
  if (record.snapshotPath?.trim()) {
    return record.snapshotPath.trim();
  }

  if (record.outputDir?.trim()) {
    return `(not exported, output dir: ${record.outputDir.trim()})`;
  }

  return "(not exported)";
}

export function buildFailureIssueDraft(params: FailureIssueDraftParams): string {
  const representativeCommand =
    params.representativeCommand?.trim() ||
    params.records.find((record) => record.commandLine?.trim())?.commandLine?.trim() ||
    "(not captured)";

  const lines = [
    "## Failure Summary",
    "",
    `- provider: ${params.providerId}`,
    `- signature: ${params.signature}`,
    `- frequency: ${params.frequency}`,
    "",
    "## Representative Command",
    "",
    "```bash",
    representativeCommand,
    "```",
    "",
    "## Recent Occurrences",
  ];

  const records = params.records.slice(0, 5);
  if (records.length === 0) {
    lines.push("- (no records)");
  } else {
    for (const record of records) {
      lines.push(`- ${record.finishedAt} (${record.id})`);
      lines.push(`  - project: ${record.projectPath}`);
      lines.push(`  - snapshot: ${formatSnapshotRef(record)}`);
      if (record.error?.trim()) {
        lines.push(`  - error: ${record.error.trim()}`);
      }
    }
  }

  lines.push("", "## Follow-up", "", "- [ ] verify reproduction in clean environment", "- [ ] link diagnostics bundle and snapshot paths");

  return lines.join("\n");
}
