import type { Repository } from "@/lib/store/types";
import type { ExecutionRecord } from "@/lib/store/types";
import { isPathEqualOrInside } from "@/lib/paths";
import type {
  HistoryFilterStatus,
  HistoryFilterWindow,
} from "@/features/history/historyFilterPresets";

interface HistoryFilterState {
  provider: string;
  status: HistoryFilterStatus;
  window: HistoryFilterWindow;
  keyword: string;
}

export function filterExecutionHistory(
  records: ExecutionRecord[],
  filter: HistoryFilterState,
  now = Date.now()
): ExecutionRecord[] {
  const keyword = filter.keyword.trim().toLowerCase();
  const windowStartMs =
    filter.window === "24h"
      ? now - 24 * 60 * 60 * 1000
      : filter.window === "7d"
        ? now - 7 * 24 * 60 * 60 * 1000
        : filter.window === "30d"
          ? now - 30 * 24 * 60 * 60 * 1000
          : null;

  return records.filter((record) => {
    if (filter.provider !== "all" && record.providerId !== filter.provider) {
      return false;
    }

    if (filter.status === "success" && !record.success) {
      return false;
    }
    if (filter.status === "cancelled" && !record.cancelled) {
      return false;
    }
    if (filter.status === "failed" && (record.success || record.cancelled)) {
      return false;
    }

    if (windowStartMs !== null) {
      const finishedAt = Date.parse(record.finishedAt);
      if (Number.isNaN(finishedAt) || finishedAt < windowStartMs) {
        return false;
      }
    }

    if (!keyword) {
      return true;
    }

    const haystack = [
      record.providerId,
      record.projectPath,
      record.error || "",
      record.commandLine || "",
      record.failureSignature || "",
      record.outputExcerpt || "",
    ]
      .join("\n")
      .toLowerCase();

    return haystack.includes(keyword);
  });
}

export function isRecordInRepository(
  record: ExecutionRecord,
  repo: Repository
): boolean {
  if (record.repoId && record.repoId === repo.id) {
    return true;
  }

  return isPathEqualOrInside(record.projectPath || "", repo.path);
}
