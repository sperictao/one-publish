import { invoke } from "@tauri-apps/api/core";

import type {
  PublishSpec,
  RenderedPublishCommand,
} from "@/generated/tauri-contracts";

export async function renderPublishCommand(
  spec: PublishSpec
): Promise<RenderedPublishCommand> {
  return await invoke<RenderedPublishCommand>("render_provider_publish", { spec });
}
