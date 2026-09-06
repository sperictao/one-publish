import { invoke } from "@tauri-apps/api/core";

import type {
  CancelPublishRuntimeRequest,
  CommandImportDiagnostic,
  CommandImportResult,
  PreparedPublishRuntime,
  PreparePublishRuntimeRequest,
  PublishOutputPreflightResult,
  PublishResult as TauriPublishResult,
  PublishRuntimeResult,
  PublishSource,
  PublishSourceDiagnostic,
  ResolvedPublishSource,
  ResumePublishRuntimeRequest,
  PublishSpec as TauriPublishSpec,
  StartPublishRuntimeRequest,
  SynchronizePublishRuntimeRequest,
  SynchronizePublishRuntimeResult,
} from "@/generated/tauri-contracts";

export type ProviderPublishSpec = TauriPublishSpec;
export type PublishResult = TauriPublishResult;
export type { CommandImportDiagnostic, CommandImportResult };
/** prepare 结果的 ready 形状；只有 ready 携带可执行 runtimeToken。 */
export type ReadyPublishRuntime = Extract<
  PreparedPublishRuntime,
  { status: "ready" }
>;
export type {
  CancelPublishRuntimeRequest,
  PreparedPublishRuntime,
  PreparePublishRuntimeRequest,
  PublishOutputPreflightResult,
  PublishRuntimeResult,
  PublishSource,
  PublishSourceDiagnostic,
  ResolvedPublishSource,
  ResumePublishRuntimeRequest,
  StartPublishRuntimeRequest,
  SynchronizePublishRuntimeRequest,
  SynchronizePublishRuntimeResult,
};

export interface ImportFromCommandParams {
  command: string;
  providerId: string;
  projectPath: string;
}

export async function preparePublishRuntime(
  request: PreparePublishRuntimeRequest
): Promise<PreparedPublishRuntime> {
  return await invoke<PreparedPublishRuntime>("prepare_publish_runtime", {
    request,
  });
}

export async function resolvePublishSource(
  repositoryId: string,
  source: PublishSource
): Promise<ResolvedPublishSource> {
  return await invoke<ResolvedPublishSource>("resolve_publish_source", {
    repositoryId,
    source,
  });
}

export async function startPublishRuntime(
  request: StartPublishRuntimeRequest
): Promise<PublishRuntimeResult> {
  return await invoke<PublishRuntimeResult>("start_publish_runtime", {
    request,
  });
}

export async function resumePublishRuntime(
  request: ResumePublishRuntimeRequest
): Promise<PublishRuntimeResult> {
  return await invoke<PublishRuntimeResult>("resume_publish_runtime", {
    request,
  });
}

export async function synchronizePublishRuntime(
  request: SynchronizePublishRuntimeRequest
): Promise<SynchronizePublishRuntimeResult> {
  return await invoke<SynchronizePublishRuntimeResult>(
    "synchronize_publish_runtime",
    { request }
  );
}

export async function cancelPublishRuntime(
  request: CancelPublishRuntimeRequest
): Promise<boolean> {
  return await invoke<boolean>("cancel_publish_runtime", { request });
}

export async function preflightProviderPublishOutput(
  spec: ProviderPublishSpec
): Promise<PublishOutputPreflightResult> {
  return await invoke<PublishOutputPreflightResult>(
    "preflight_publish_output",
    { spec }
  );
}

export async function importFromCommand({
  command,
  providerId,
  projectPath,
}: ImportFromCommandParams): Promise<CommandImportResult> {
  return await invoke<CommandImportResult>("import_from_command", {
    command,
    providerId,
    projectPath,
  });
}

/** Only output access denial can be resolved by requesting directory access. */
export function canRequestRuntimeOutputAccess(
  prepared: PreparedPublishRuntime | null | undefined
): boolean {
  return (
    prepared?.status === "blocked" &&
    prepared.outputPreflight?.accessStatus === "denied" &&
    prepared.diagnostics.length > 0 &&
    prepared.diagnostics.every(
      (item) => item.code === "publish_output_access_denied"
    )
  );
}
