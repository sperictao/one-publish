import { invoke } from "@tauri-apps/api/core";
import type { ExecutionRecord } from "@/lib/store/types";

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

// 快照由后端写入私有存储区（~/.one-publish/execution-snapshots/）并按输出目录归档，
// 绝不写进 Provider 输出目录：否则下一次发布会把它当作产物收集并交付。
export async function exportExecutionSnapshot(
  record: ExecutionRecord,
  outputLog: string
): Promise<string | null> {
  if (!record.outputDir) {
    return null;
  }

  try {
    return await invoke<string>("export_execution_snapshot", {
      outputDir: record.outputDir,
      snapshot: buildExecutionSnapshotPayload(record, outputLog),
    });
  } catch (error) {
    console.warn("[executionSnapshot] 自动导出执行快照失败", error);
    return null;
  }
}
