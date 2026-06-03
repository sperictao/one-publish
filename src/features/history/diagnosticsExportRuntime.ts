import { invoke } from "@tauri-apps/api/core";

import type {
  DiagnosticsIndexPayload,
  ExecutionHistoryExportRow,
} from "@/features/history/diagnosticsExportPayload";

export async function exportExecutionHistoryFile(params: {
  history: ExecutionHistoryExportRow[];
  filePath: string;
}): Promise<string> {
  return await invoke<string>("export_execution_history", {
    history: params.history,
    filePath: params.filePath,
  });
}

export async function exportDiagnosticsIndexFile(params: {
  index: DiagnosticsIndexPayload;
  filePath: string;
}): Promise<string> {
  return await invoke<string>("export_diagnostics_index", {
    index: params.index,
    filePath: params.filePath,
  });
}
