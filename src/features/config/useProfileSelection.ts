import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";

import { createProjectProfileSelectedPreset } from "@/features/config/publishConfigIdentity";
import type { ConfigProfile } from "@/lib/store/types";
import type { LoadableProfile } from "./types";

export interface UseProfileSelectionParams {
  setIsCustomMode: (value: boolean) => void;
  setSelectedPreset: (value: string) => void;
  setActiveProfileName: Dispatch<SetStateAction<string | null>>;
  applyProfile: (profile: LoadableProfile) => void;
}

export interface UseProfileSelectionReturn {
  handleSelectProjectProfile: (profileName: string) => void;
  handleSelectProfileFromPanel: (profile: ConfigProfile) => void;
}

export function useProfileSelection({
  setIsCustomMode,
  setSelectedPreset,
  setActiveProfileName,
  applyProfile,
}: UseProfileSelectionParams): UseProfileSelectionReturn {
  const handleSelectProjectProfile = useCallback(
    (profileName: string) => {
      setSelectedPreset(createProjectProfileSelectedPreset(profileName));
      setIsCustomMode(false);
      setActiveProfileName(null);
    },
    [setIsCustomMode, setSelectedPreset, setActiveProfileName]
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
