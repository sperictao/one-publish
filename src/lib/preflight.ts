import { invoke } from "@tauri-apps/api/core";

import type { PackageResult, SignResult } from "@/lib/artifact";
import type { EnvironmentCheckResult } from "@/lib/environment";
import type { UpdaterConfigHealth } from "@/lib/store";

export type PreflightStepStatus = "pass" | "warning" | "fail" | "pending";

export interface PreflightChecklistItem {
  id: string;
  title: string;
  description: string;
  status: PreflightStepStatus;
  detail: string;
}

export interface PreflightReportPayload {
  generatedAt: string;
  summary: {
    passed: number;
    warning: number;
    failed: number;
    blockingReady: boolean;
  };
  publishResult: {
    success: boolean;
    outputDir: string;
    fileCount: number;
    error: string | null;
  } | null;
  environmentResult: EnvironmentCheckResult | null;
  artifact: {
    packageResult: PackageResult | null;
    signResult: SignResult | null;
  };
  updater: {
    health: UpdaterConfigHealth | null;
    error: string | null;
  };
  checklist: PreflightChecklistItem[];
}

export async function exportPreflightReport(params: {
  filePath: string;
  report: PreflightReportPayload;
}): Promise<string> {
  return await invoke<string>("export_preflight_report", {
    filePath: params.filePath,
    report: params.report,
  });
}
