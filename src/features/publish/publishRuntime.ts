import { invoke } from "@tauri-apps/api/core";

import type {
  CancelPublishRuntimeRequest,
  PreparedPublishRuntime,
  PrepareDraftPublishRuntimeRequest,
  PreparePublishRuntimeRequest,
  PublishOutputPreflightResult,
  PublishResult as TauriPublishResult,
  PublishRuntimeResult,
  ResumePublishRuntimeRequest,
  PublishSpec as TauriPublishSpec,
  StartPublishRuntimeRequest,
  SynchronizePublishRuntimeRequest,
  SynchronizePublishRuntimeResult,
} from "@/generated/tauri-contracts";

export type ProviderPublishSpec = TauriPublishSpec;
export type PublishResult = TauriPublishResult;
export type {
  CancelPublishRuntimeRequest,
  PreparedPublishRuntime,
  PrepareDraftPublishRuntimeRequest,
  PreparePublishRuntimeRequest,
  PublishOutputPreflightResult,
  PublishRuntimeResult,
  ResumePublishRuntimeRequest,
  StartPublishRuntimeRequest,
  SynchronizePublishRuntimeRequest,
  SynchronizePublishRuntimeResult,
};

export interface ImportProviderPublishSpecFromCommandParams {
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

export async function prepareDraftPublishRuntime(
  request: PrepareDraftPublishRuntimeRequest
): Promise<PreparedPublishRuntime> {
  return await invoke<PreparedPublishRuntime>("prepare_draft_publish_runtime", {
    request,
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

export async function importProviderPublishSpecFromCommand({
  command,
  providerId,
  projectPath,
}: ImportProviderPublishSpecFromCommandParams): Promise<ProviderPublishSpec> {
  return await invoke<ProviderPublishSpec>("import_from_command", {
    command,
    providerId,
    projectPath,
  });
}
