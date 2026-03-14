import { useCallback, useMemo } from "react";

import type { PublishConfigStore, ProviderManifest } from "@/lib/store";

const FALLBACK_PROVIDERS: ProviderManifest[] = [
  { id: "dotnet", displayName: "dotnet", version: "1" },
  { id: "cargo", displayName: "cargo", version: "1" },
  { id: "go", displayName: "go", version: "1" },
  { id: "java", displayName: "java", version: "1" },
];

function formatProviderLabel(provider: ProviderManifest): string {
  if (provider.id === "dotnet") return ".NET (dotnet)";
  if (provider.id === "cargo") return "Rust (cargo)";
  if (provider.id === "go") return "Go";
  if (provider.id === "java") return "Java (gradle)";
  return provider.displayName || provider.id;
}

export function useProviderPresentationState(params: {
  providerRuntimeProviders: ProviderManifest[];
  activeProvider: ProviderManifest | null;
  activeProviderId: string;
  customConfig: PublishConfigStore;
  setCustomConfig: (value: PublishConfigStore) => void;
}) {
  const availableProviders = useMemo(
    () =>
      params.providerRuntimeProviders.length > 0
        ? params.providerRuntimeProviders
        : FALLBACK_PROVIDERS,
    [params.providerRuntimeProviders]
  );

  const resolvedActiveProvider = useMemo(
    () =>
      params.activeProvider ||
      availableProviders.find((provider) => provider.id === params.activeProviderId) ||
      availableProviders[0] ||
      FALLBACK_PROVIDERS[0],
    [params.activeProvider, params.activeProviderId, availableProviders]
  );

  const activeProviderLabel = useMemo(
    () => formatProviderLabel(resolvedActiveProvider),
    [resolvedActiveProvider]
  );

  const repositoryProviders = useMemo(
    () =>
      availableProviders.map((provider) => ({
        ...provider,
        label: formatProviderLabel(provider),
      })),
    [availableProviders]
  );

  const handleCustomConfigUpdate = useCallback(
    (updates: Partial<PublishConfigStore>) => {
      params.setCustomConfig({ ...params.customConfig, ...updates });
    },
    [params]
  );

  return {
    availableProviders,
    resolvedActiveProvider,
    activeProviderLabel,
    repositoryProviders,
    handleCustomConfigUpdate,
  };
}
