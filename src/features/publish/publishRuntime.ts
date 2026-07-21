import { invoke } from "@tauri-apps/api/core";

import type {
  PreparedPublishRuntime,
  PreparePublishRuntimeRequest,
  PublishOutputPreflightResult,
  PublishResult as TauriPublishResult,
  PublishRuntimeResult,
  PublishSpec as TauriPublishSpec,
  RenderedPublishCommand,
  StartPublishRuntimeRequest,
} from "@/generated/tauri-contracts";

export type ProviderPublishSpec = TauriPublishSpec;
export type PublishResult = TauriPublishResult;
export type {
  PreparedPublishRuntime,
  PreparePublishRuntimeRequest,
  PublishOutputPreflightResult,
  PublishRuntimeResult,
  RenderedPublishCommand,
  StartPublishRuntimeRequest,
};

export interface ImportProviderPublishSpecFromCommandParams {
  command: string;
  providerId: string;
  projectPath: string;
}

export async function executeProviderPublish(
  spec: ProviderPublishSpec
): Promise<PublishResult> {
  return await invoke<PublishResult>("execute_provider_publish", { spec });
}

export async function preparePublishRuntime(
  request: PreparePublishRuntimeRequest
): Promise<PreparedPublishRuntime> {
  return await invoke<PreparedPublishRuntime>("prepare_publish_runtime", {
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

export async function cancelProviderPublish(): Promise<boolean> {
  return await invoke<boolean>("cancel_provider_publish");
}

export async function renderProviderPublish(
  spec: ProviderPublishSpec
): Promise<RenderedPublishCommand> {
  return await invoke<RenderedPublishCommand>("render_provider_publish", {
    spec,
  });
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
