import {
  useCallback,
  useEffect,
  type Dispatch,
  type SetStateAction,
} from "react";

import { resolveProviderIdCandidate } from "@/lib/providers";
import type { ProviderManifest, Repository } from "@/lib/store";

interface UseEditorProviderStateParams {
  availableProviders: ProviderManifest[];
  selectedRepo: Pick<Repository, "id" | "providerId"> | null;
  setActiveProviderId: Dispatch<SetStateAction<string>>;
}

function useResolvedEditorProviderSetter(
  availableProviders: ProviderManifest[],
  setActiveProviderId: Dispatch<SetStateAction<string>>
) {
  return useCallback(
    (providerId?: string | null) => {
      setActiveProviderId((currentProviderId) => {
        const nextProviderId = resolveProviderIdCandidate(
          providerId,
          availableProviders,
          currentProviderId
        );

        return currentProviderId === nextProviderId
          ? currentProviderId
          : nextProviderId;
      });
    },
    [availableProviders, setActiveProviderId]
  );
}

export function useEditorProviderState({
  availableProviders,
  selectedRepo,
  setActiveProviderId,
}: UseEditorProviderStateParams) {
  const applyEditorProvider = useResolvedEditorProviderSetter(
    availableProviders,
    setActiveProviderId
  );

  useEffect(() => {
    if (!selectedRepo) {
      return;
    }

    applyEditorProvider(selectedRepo.providerId);
  }, [applyEditorProvider, selectedRepo]);

  const applyProfileProvider = useCallback(
    (providerId: string) => {
      applyEditorProvider(providerId);
    },
    [applyEditorProvider]
  );

  const applyRecoveredSpecProvider = useCallback(
    (providerId: string) => {
      applyEditorProvider(providerId);
    },
    [applyEditorProvider]
  );

  const applySelectedRepositoryProvider = useCallback(
    (providerId?: string | null) => {
      applyEditorProvider(providerId);
    },
    [applyEditorProvider]
  );

  return {
    applyProfileProvider,
    applyRecoveredSpecProvider,
    applySelectedRepositoryProvider,
  };
}
