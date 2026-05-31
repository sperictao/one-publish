import { invoke } from "@tauri-apps/api/core";

import type {
  PublishOutputPreflightResult,
  PublishResult as TauriPublishResult,
  PublishSpec as TauriPublishSpec,
  RenderedPublishCommand,
} from "@/generated/tauri-contracts";

export type ProviderPublishSpec = TauriPublishSpec;
export type PublishResult = TauriPublishResult;
export type { PublishOutputPreflightResult, RenderedPublishCommand };

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
