import { invoke } from "@tauri-apps/api/core";
import { joinPath } from "@/lib/paths";
import type { ExecutionRecord } from "@/lib/store/types";

// 文件名必须以 execution-snapshot- 开头且扩展名为 md，
// 后端 find_latest_snapshot_in_output_dir 按此约定扫描输出目录。
export function buildExecutionSnapshotFileName(finishedAt: string): string {
  return `execution-snapshot-${finishedAt.replace(/[:]/g, "-")}.md`;
}

export function buildExecutionSnapshotPayload(
  record: ExecutionRecord,
  outputLog: string
) {
  return {
    generatedAt: record.finishedAt,
    providerId: record.providerId,
    spec: record.spec ?? null,
    command: record.commandLine ? { line: record.commandLine } : null,
    result: {
      success: record.success,
      cancelled: record.cancelled,
      error: record.error ?? null,
      outputDir: record.outputDir ?? null,
      fileCount: record.fileCount,
    },
    output: {
      log: outputLog,
    },
  };
}

export async function exportExecutionSnapshot(
  record: ExecutionRecord,
  outputLog: string
): Promise<string | null> {
  if (!record.outputDir) {
    return null;
  }

  try {
    return await invoke<string>("export_execution_snapshot", {
      filePath: joinPath(
        record.outputDir,
        buildExecutionSnapshotFileName(record.finishedAt)
      ),
      snapshot: buildExecutionSnapshotPayload(record, outputLog),
    });
  } catch (error) {
    console.warn("[executionSnapshot] 自动导出执行快照失败", error);
    return null;
  }
}
