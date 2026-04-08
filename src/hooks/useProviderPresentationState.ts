import { useCallback, useMemo } from "react";

import type { PublishConfigStore, ProviderManifest } from "@/lib/store";
import { resolveProviderLabel } from "@/lib/providers";

export function useProviderPresentationState(params: {
  providerRuntimeProviders: ProviderManifest[];
  activeProvider: ProviderManifest | null;
  activeProviderId: string;
  customConfig: PublishConfigStore;
  setCustomConfig: (value: PublishConfigStore) => void;
}) {
  const availableProviders = useMemo(
    () => params.providerRuntimeProviders,
    [params.providerRuntimeProviders]
  );

  const resolvedActiveProvider = useMemo(
    () =>
      params.activeProvider ||
      availableProviders.find((provider) => provider.id === params.activeProviderId) ||
      availableProviders[0] ||
      null,
    [params.activeProvider, params.activeProviderId, availableProviders]
  );

  const activeProviderLabel = useMemo(
    () => resolveProviderLabel(resolvedActiveProvider, params.activeProviderId),
    [params.activeProviderId, resolvedActiveProvider]
  );

  const repositoryProviders = useMemo(
    () =>
      availableProviders.map((provider) => ({
        ...provider,
        label: resolveProviderLabel(provider),
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
