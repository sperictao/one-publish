import type { PublishEditStateUpdate } from "@/generated/tauri-contracts";
import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { ConfigProfile } from "@/lib/store/types";
import type { LoadableProfile } from "./types";

export interface UseProfileSelectionParams {
  updatePublishEditState: (update: PublishEditStateUpdate) => void;
  setActiveProfileName: Dispatch<SetStateAction<string | null>>;
  /** 成功时自行记录激活名；Provider 与仓库不一致时拒绝并返回 false。 */
  applyProfile: (profile: LoadableProfile) => boolean;
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
      applyProfile(profile);
    },
    [applyProfile]
  );

  return {
    handleSelectProjectProfile,
    handleSelectProfileFromPanel,
  };
}
