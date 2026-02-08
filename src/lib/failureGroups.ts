import { resolveFailureSignature } from "@/lib/failureSignature";
import type { ExecutionRecord } from "@/lib/store";

export interface FailureGroup {
  key: string;
  providerId: string;
  signature: string;
  count: number;
  latestRecord: ExecutionRecord;
  records: ExecutionRecord[];
}

function getFinishedAtTimestamp(record: ExecutionRecord): number {
  const timestamp = Date.parse(record.finishedAt);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function groupExecutionFailures(
  executionHistory: ExecutionRecord[]
): FailureGroup[] {
  const grouped = new Map<string, FailureGroup>();

  for (const record of executionHistory) {
    if (record.success || record.cancelled) {
      continue;
    }

    const signature = resolveFailureSignature(record);
    if (!signature) {
      continue;
    }

    const key = `${record.providerId}::${signature}`;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        key,
        providerId: record.providerId,
        signature,
        count: 1,
        latestRecord: record,
        records: [record],
      });
      continue;
    }

    existing.count += 1;
    existing.records.push(record);

    if (
      getFinishedAtTimestamp(record) >
      getFinishedAtTimestamp(existing.latestRecord)
    ) {
      existing.latestRecord = record;
    }
  }

  return Array.from(grouped.values())
    .map((group) => {
      const records = [...group.records].sort(
        (a, b) => getFinishedAtTimestamp(b) - getFinishedAtTimestamp(a)
      );

      return {
        ...group,
        records,
        latestRecord: records[0] ?? group.latestRecord,
      };
    })
    .sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }

      return (
        getFinishedAtTimestamp(b.latestRecord) -
        getFinishedAtTimestamp(a.latestRecord)
      );
    });
}

export function getRepresentativeRecord(group: FailureGroup): ExecutionRecord {
  return (
    group.records.find((record) => Boolean(record.commandLine?.trim())) ??
    group.latestRecord
  );
}
