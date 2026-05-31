import {
  renderProviderPublish,
  type ProviderPublishSpec,
  type RenderedPublishCommand,
} from "@/features/publish/publishRuntime";

export async function renderPublishCommand(
  spec: ProviderPublishSpec
): Promise<RenderedPublishCommand> {
  return await renderProviderPublish(spec);
}
