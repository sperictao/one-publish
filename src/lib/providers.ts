import type { ProviderManifest, ProviderProjectPathKind } from "@/lib/store";

type ProviderPresentation = Pick<
  ProviderManifest,
  | "id"
  | "displayName"
  | "label"
  | "commandExample"
  | "environmentLabel"
  | "environmentDescription"
  | "requiresProjectBinding"
  | "projectPathKind"
  | "supportsCommandImport"
>;

export interface EnvironmentProviderOption {
  id: string;
  label: string;
  description: string;
}

export function resolveProviderIdCandidate(
  providerId: string | null | undefined,
  providers: ProviderManifest[],
  fallbackProviderId = "dotnet"
): string {
  const normalizedProviderId = providerId?.trim() || "";
  if (normalizedProviderId) {
    const matchedProvider = providers.find(
      (provider) => provider.id === normalizedProviderId
    );
    if (matchedProvider) {
      return matchedProvider.id;
    }
  }

  return providers[0]?.id || fallbackProviderId;
}

export function resolveProviderLabel(
  provider: ProviderPresentation | null | undefined,
  fallbackProviderId?: string
): string {
  return (
    provider?.label?.trim() ||
    provider?.displayName?.trim() ||
    provider?.id?.trim() ||
    fallbackProviderId?.trim() ||
    "Provider"
  );
}

export function resolveProviderCommandExample(
  provider: ProviderPresentation | null | undefined
): string {
  return provider?.commandExample?.trim() || "";
}

export function resolveProviderProjectPathKind(
  provider: ProviderPresentation | null | undefined
): ProviderProjectPathKind {
  return provider?.projectPathKind ?? "repository_root";
}

export function providerUsesProjectFile(
  provider: ProviderPresentation | null | undefined
): boolean {
  return resolveProviderProjectPathKind(provider) === "project_file";
}

export function providerRequiresProjectBinding(
  provider: ProviderPresentation | null | undefined
): boolean {
  return (
    provider?.requiresProjectBinding ?? providerUsesProjectFile(provider)
  );
}

export function resolveEnvironmentProviderOptions(
  providers: ProviderManifest[]
): EnvironmentProviderOption[] {
  return providers.map((provider) => ({
    id: provider.id,
    label:
      provider.environmentLabel ||
      provider.label ||
      provider.displayName ||
      provider.id,
    description:
      provider.environmentDescription || provider.displayName || provider.id,
  }));
}
