import { deriveFailureSignature } from "@/lib/failureSignature";
import type { ExecutionRecord } from "@/lib/store";
import type {
  ProviderPublishSpec,
  PublishResult,
} from "@/hooks/usePublishRunner";

export function createPublishExecutionRecord(params: {
  spec: ProviderPublishSpec;
  repoId: string | null;
  startedAt: string;
  finishedAt: string;
  result: PublishResult;
  output: string;
}): ExecutionRecord {
  const commandLine =
    params.output.split("\n").find((line) => line.startsWith("$ ")) || null;
  const failureSignature =
    !params.result.success && !params.result.cancelled
      ? deriveFailureSignature({
          error: params.result.error,
          output: params.output,
        })
      : null;

  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    repoId: params.repoId,
    providerId: params.spec.provider_id,
    projectPath: params.spec.project_path,
    startedAt: params.startedAt,
    finishedAt: params.finishedAt,
    success: params.result.success,
    cancelled: params.result.cancelled,
    outputDir: params.result.output_dir || null,
    error: params.result.error,
    commandLine,
    snapshotPath: null,
    failureSignature,
    spec: params.spec,
    fileCount: params.result.file_count,
  };
}
