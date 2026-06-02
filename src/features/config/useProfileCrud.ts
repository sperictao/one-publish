import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import type { Dispatch, SetStateAction } from "react";

import { mapImportedSpecByProvider } from "@/features/provider/commandImportMapping";
import {
  createDotnetPublishConfigFromParameters,
} from "@/features/config/dotnetPublishConfig";
import { createUserProfileConfigKey } from "@/features/config/publishConfigIdentity";
import type {
  ConfigParameters,
  ConfigProfile,
  PublishConfigStore,
} from "@/lib/store/types";
import type { ParameterSchema, ParameterValue } from "@/types/parameters";
import { buildCopiedProfileName } from "@/lib/profileListSnapshot";
import type {
  TranslationMap,
  LoadableProfile,
  ProfileManagementSaveParams,
  ProfileManagementActions,
} from "./types";

interface StoreMutationResult {
  repositories: Array<{
    id: string;
    publishConfig: { profiles: ConfigProfile[] };
  }>;
}

export interface UseProfileCrudParams {
  selectedRepoId: string | null;
  profiles: ConfigProfile[];
  activeProfileName: string | null;
  isCustomMode: boolean;
  defaultPresetId: string;
  profileT: TranslationMap;
  appT: TranslationMap;
  activeProviderId: string;
  providerSchemas: Record<string, ParameterSchema>;
  applyProfileProvider: (providerId: string) => void;
  applyDotnetCustomConfig: (config: PublishConfigStore) => void;
  setProviderParameters: Dispatch<
    SetStateAction<Record<string, Record<string, ParameterValue>>>
  >;
  setIsCustomMode: (value: boolean) => void;
  setSelectedPreset: (value: string) => void;
  setActiveProfileName: Dispatch<SetStateAction<string | null>>;
  buildProfileParameters: (config: PublishConfigStore) => ConfigParameters;
  refreshProfilesAfterMutation: (
    repoId: string,
    preFetchedProfiles?: ConfigProfile[]
  ) => Promise<ConfigProfile[]>;
  isCurrentRepo: (repoId: string) => boolean;
  saveProfileToStore: (params: {
    repoId: string;
    name: string;
    providerId: string;
    parameters: ConfigParameters;
    profileGroup?: string;
  }) => Promise<StoreMutationResult>;
  deleteProfileFromStore: (
    repoId: string,
    name: string
  ) => Promise<StoreMutationResult>;
  exportConfigFn: (params: {
    profiles: ConfigProfile[];
    filePath: string;
  }) => Promise<string>;
  applyImportedConfigFn: (
    repoId: string,
    profiles: ConfigProfile[]
  ) => Promise<void>;
}

export interface UseProfileCrudReturn {
  applyProfile: (profile: LoadableProfile) => void;
  handleLoadProfile: (profile: LoadableProfile) => void;
  saveProfile: (params: ProfileManagementSaveParams) => Promise<void>;
  deleteProfile: (profile: ConfigProfile) => Promise<void>;
  deleteProfileByName: (repoId: string, name: string) => Promise<void>;
  exportProfiles: (filePath: string) => Promise<void>;
  applyImportedProfiles: (profiles: ConfigProfile[]) => Promise<void>;
  handleCreateProfileFromProjectProfile: (
    sourceProfileName: string,
    config: PublishConfigStore
  ) => Promise<string>;
  profileManagement: ProfileManagementActions;
}

export function useProfileCrud({
  selectedRepoId,
  profiles,
  activeProfileName,
  isCustomMode,
  defaultPresetId,
  profileT,
  appT,
  activeProviderId,
  providerSchemas,
  applyProfileProvider,
  applyDotnetCustomConfig,
  setProviderParameters,
  setIsCustomMode,
  setSelectedPreset,
  setActiveProfileName,
  buildProfileParameters,
  refreshProfilesAfterMutation,
  isCurrentRepo,
  saveProfileToStore,
  deleteProfileFromStore,
  exportConfigFn,
  applyImportedConfigFn,
}: UseProfileCrudParams): UseProfileCrudReturn {
  const applyProfile = useCallback(
    (profile: LoadableProfile) => {
      const profileProviderId =
        profile.providerId || profile.provider_id || activeProviderId;
      const schema = providerSchemas[profileProviderId];
      const mapping = mapImportedSpecByProvider(
        {
          providerId: profileProviderId,
          parameters: profile.parameters || {},
        },
        profileProviderId,
        {
          supportedKeys: schema ? Object.keys(schema.parameters) : undefined,
        }
      );

      if (profileProviderId !== activeProviderId) {
        applyProfileProvider(profileProviderId);
      }

      if (mapping.providerId === "dotnet") {
        applyDotnetCustomConfig(
          createDotnetPublishConfigFromParameters(
            (profile.parameters || {}) as Record<string, unknown>,
            {
              inferProfileSelection: true,
            }
          )
        );
        setSelectedPreset(createUserProfileConfigKey(profile.name));
        setActiveProfileName(profile.name);
      } else {
        setProviderParameters((prev) => ({
          ...prev,
          [mapping.providerId]: mapping.providerParameters,
        }));
      }

      toast.success(appT.profileLoaded || "配置文件已加载", {
        description: `${appT.loadedProfile || "已加载配置文件"}: ${profile.name}`,
      });
    },
    [
      activeProviderId,
      applyProfileProvider,
      applyDotnetCustomConfig,
      appT,
      providerSchemas,
      setActiveProfileName,
      setProviderParameters,
      setSelectedPreset,
    ]
  );

  const handleLoadProfile = useCallback(
    (profile: LoadableProfile) => {
      applyProfile(profile);
    },
    [applyProfile]
  );

  const deleteProfileByName = useCallback(
    async (repoId: string, name: string) => {
      const state = await deleteProfileFromStore(repoId, name);
      const repo = state.repositories.find((r) => r.id === repoId);
      if (repo) {
        await refreshProfilesAfterMutation(repoId, repo.publishConfig.profiles);
      }
      if (isCurrentRepo(repoId)) {
        if (activeProfileName === name) {
          setActiveProfileName(null);
          if (isCustomMode) {
            setIsCustomMode(false);
            setSelectedPreset(defaultPresetId);
          }
        }
      }
    },
    [
      activeProfileName,
      defaultPresetId,
      isCurrentRepo,
      isCustomMode,
      refreshProfilesAfterMutation,
      setIsCustomMode,
      setSelectedPreset,
      setActiveProfileName,
      deleteProfileFromStore,
    ]
  );

  const saveProfile = useCallback(
    async ({
      name,
      providerId,
      parameters,
      profileGroup,
    }: ProfileManagementSaveParams) => {
      if (!selectedRepoId) {
        throw new Error(profileT.saveFailed || "保存配置文件失败");
      }

      const repoId = selectedRepoId;

      const state = await saveProfileToStore({
        repoId,
        name,
        providerId,
        parameters,
        profileGroup,
      });
      const repo = state.repositories.find((r) => r.id === repoId);
      if (repo) {
        await refreshProfilesAfterMutation(repoId, repo.publishConfig.profiles);
      }
    },
    [profileT.saveFailed, refreshProfilesAfterMutation, selectedRepoId, saveProfileToStore]
  );

  const deleteProfile = useCallback(
    async (profile: ConfigProfile) => {
      if (!selectedRepoId) {
        throw new Error(profileT.deleteFailed || "删除配置文件失败");
      }

      await deleteProfileByName(selectedRepoId, profile.name);
    },
    [deleteProfileByName, profileT.deleteFailed, selectedRepoId]
  );

  const exportProfiles = useCallback(
    async (filePath: string) => {
      await exportConfigFn({
        profiles,
        filePath,
      });
    },
    [profiles, exportConfigFn]
  );

  const applyImportedProfiles = useCallback(
    async (importedProfiles: ConfigProfile[]) => {
      if (!selectedRepoId) {
        throw new Error(profileT.importFailed || "导入配置失败");
      }

      const repoId = selectedRepoId;

      await applyImportedConfigFn(repoId, importedProfiles);
      await refreshProfilesAfterMutation(repoId);
    },
    [profileT.importFailed, refreshProfilesAfterMutation, selectedRepoId, applyImportedConfigFn]
  );

  const handleCreateProfileFromProjectProfile = useCallback(
    async (sourceProfileName: string, config: PublishConfigStore) => {
      if (!selectedRepoId) {
        throw new Error(profileT.saveFailed || "保存配置文件失败");
      }

      const existingNames = new Set(profiles.map((profile) => profile.name));
      const profileName = buildCopiedProfileName(sourceProfileName, existingNames);
      const parameters = buildProfileParameters(config);

      const state = await saveProfileToStore({
        repoId: selectedRepoId,
        name: profileName,
        providerId: "dotnet",
        parameters,
      });

      const repo = state.repositories.find((r) => r.id === selectedRepoId);
      if (repo) {
        await refreshProfilesAfterMutation(
          selectedRepoId,
          repo.publishConfig.profiles
        );
      }

      setActiveProfileName(profileName);
      applyDotnetCustomConfig(config);
      setSelectedPreset(createUserProfileConfigKey(profileName));

      return profileName;
    },
    [
      applyDotnetCustomConfig,
      buildProfileParameters,
      profileT.saveFailed,
      profiles,
      refreshProfilesAfterMutation,
      selectedRepoId,
      setActiveProfileName,
      setSelectedPreset,
      saveProfileToStore,
    ]
  );

  const profileManagement = useMemo<ProfileManagementActions>(
    () => ({
      profiles,
      isRefreshing: false,
      refreshProfiles: async () => [],
      saveProfile,
      deleteProfile,
      exportProfiles,
      applyImportedProfiles,
    }),
    [
      applyImportedProfiles,
      deleteProfile,
      exportProfiles,
      profiles,
      saveProfile,
    ]
  );

  return {
    applyProfile,
    handleLoadProfile,
    saveProfile,
    deleteProfile,
    deleteProfileByName,
    exportProfiles,
    applyImportedProfiles,
    handleCreateProfileFromProjectProfile,
    profileManagement,
  };
}
