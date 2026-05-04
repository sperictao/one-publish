import {
  renderProviderPublish,
  type ProviderPublishSpec,
  type RenderedPublishCommand,
} from "@/lib/publishRuntime";

export async function renderPublishCommand(
  spec: ProviderPublishSpec
): Promise<RenderedPublishCommand> {
  return await renderProviderPublish(spec);
}
