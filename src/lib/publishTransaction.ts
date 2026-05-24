import { normalizePublishResult } from "@/lib/publishFailure";
import type {
  ProviderPublishSpec,
  PublishResult,
} from "@/lib/publishRuntime";

export interface PublishTransactionRunOptions {
  repoId?: string | null;
  recentConfigKey?: string | null;
  openOutputDirOnSuccess?: boolean;
  restoreWindowOnFailure?: boolean;
  feedbackMode?: "toast" | "system";
  trayStatusEffect?: boolean;
}

export interface PublishTransactionContext {
  repoId: string | null;
  recentConfigKey: string | null;
  openOutputDirOnSuccess: boolean;
  restoreWindowOnFailure: boolean;
  feedbackMode: "toast" | "system";
  trayStatusEffect: boolean;
  startedAt: string;
}

export function createPublishTransactionContext(params: {
  selectedRepoId: string | null;
  options?: PublishTransactionRunOptions;
  startedAt?: string;
}): PublishTransactionContext {
  return {
    repoId: params.options?.repoId ?? params.selectedRepoId,
    recentConfigKey: params.options?.recentConfigKey ?? null,
    openOutputDirOnSuccess: params.options?.openOutputDirOnSuccess ?? false,
    restoreWindowOnFailure: params.options?.restoreWindowOnFailure ?? false,
    feedbackMode: params.options?.feedbackMode ?? "toast",
    trayStatusEffect: params.options?.trayStatusEffect ?? false,
    startedAt: params.startedAt ?? new Date().toISOString(),
  };
}

export function shouldRecordRecentConfig(
  transaction: Pick<PublishTransactionContext, "repoId" | "recentConfigKey">
) {
  return Boolean(transaction.repoId && transaction.recentConfigKey);
}

export function createFailedPublishTransactionResult(params: {
  spec: ProviderPublishSpec;
  errorMessage: string;
  outputLog: string;
}): PublishResult {
  return normalizePublishResult({
    result: {
      provider_id: params.spec.provider_id,
      success: false,
      cancelled: false,
      error: params.errorMessage,
      command: {
        program: "",
        args: [],
        working_dir: null,
        display_command: "",
      },
      output_log: "",
      output_dir: "",
      file_count: 0,
    },
    outputLog: params.outputLog,
  });
}
