import type { PublishEditStateUpdate } from "@/generated/tauri-contracts";
import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { ConfigProfile } from "@/lib/store/types";
import type { LoadableProfile } from "./types";

export interface UseProfileSelectionParams {
  updatePublishEditState: (update: PublishEditStateUpdate) => void;
  setActiveProfileName: Dispatch<SetStateAction<string | null>>;
  applyProfile: (profile: LoadableProfile) => void;
}

export interface UseProfileSelectionReturn {
  handleSelectProjectProfile: (profileName: string) => void;
  handleSelectProfileFromPanel: (profile: ConfigProfile) => void;
}

export function useProfileSelection({
  updatePublishEditState,
  setActiveProfileName,
  applyProfile,
}: UseProfileSelectionParams): UseProfileSelectionReturn {
  const handleSelectProjectProfile = useCallback(
    (profileName: string) => {
      updatePublishEditState({
        selection: {
          kind: "projectProfile",
          providerId: "dotnet",
          reference: profileName,
        },
      });
      setActiveProfileName(null);
    },
    [updatePublishEditState, setActiveProfileName]
  );

  const handleSelectProfileFromPanel = useCallback(
    (profile: ConfigProfile) => {
      setActiveProfileName(profile.name);
      applyProfile(profile);
    },
    [applyProfile, setActiveProfileName]
  );

  return {
    handleSelectProjectProfile,
    handleSelectProfileFromPanel,
  };
}
