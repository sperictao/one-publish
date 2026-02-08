export interface FailureIssueRecord {
  id: string;
  finishedAt: string;
  projectPath: string;
  error?: string | null;
  commandLine?: string | null;
  snapshotPath?: string | null;
  outputDir?: string | null;
}

export type IssueDraftTemplate = "bug" | "incident" | "postmortem";

export interface FailureIssueDraftParams {
  providerId: string;
  signature: string;
  frequency: number;
  representativeCommand?: string | null;
  records: FailureIssueRecord[];
  template?: IssueDraftTemplate;
  includeImpact?: boolean;
  includeWorkaround?: boolean;
  includeOwner?: boolean;
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

function resolveSummaryTitle(template: IssueDraftTemplate): string {
  if (template === "incident") {
    return "## Incident Summary";
  }
  if (template === "postmortem") {
    return "## Postmortem Summary";
  }

  return "## Bug Summary";
}

export function buildFailureIssueDraft(params: FailureIssueDraftParams): string {
  const template = params.template || "bug";
  const representativeCommand =
    params.representativeCommand?.trim() ||
    params.records.find((record) => record.commandLine?.trim())?.commandLine?.trim() ||
    "(not captured)";

  const lines = [
    resolveSummaryTitle(template),
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

  if (params.includeImpact) {
    lines.push("", "## Impact", "", "- scope: ", "- user-facing impact: ");
  }
  if (params.includeWorkaround) {
    lines.push("", "## Workaround", "", "- current mitigation: ");
  }
  if (params.includeOwner) {
    lines.push("", "## Owner", "", "- primary owner: ", "- reviewers: ");
  }

  lines.push("", "## Follow-up", "", "- [ ] verify reproduction in clean environment", "- [ ] link diagnostics bundle and snapshot paths");

  return lines.join("\n");
}
