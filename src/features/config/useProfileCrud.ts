import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import type { Dispatch, SetStateAction } from "react";

import type { PublishEditStateUpdate } from "@/generated/tauri-contracts";
import type { ConfigParameters, ConfigProfile } from "@/lib/store/types";
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

/** Provider 加载配置时，仅保留 schema 认识的参数键；无 schema 时直通。 */
function filterParametersBySchema(
  parameters: ConfigParameters,
  schema?: ParameterSchema
): ConfigParameters {
  const supportedKeys = schema ? Object.keys(schema.parameters) : [];
  const allowed = supportedKeys.length > 0 ? new Set(supportedKeys) : null;

  const filtered: ConfigParameters = {};
  for (const [key, value] of Object.entries(parameters)) {
    if (!allowed || allowed.has(key)) {
      filtered[key] = value;
    }
  }
  return filtered;
}

export interface UseProfileCrudParams {
  selectedRepoId: string | null;
  profiles: ConfigProfile[];
  activeProfileId: string | null;
  updatePublishEditState: (update: PublishEditStateUpdate) => void;
  profileT: TranslationMap;
  appT: TranslationMap;
  activeProviderId: string;
  providerSchemas: Record<string, ParameterSchema>;
  applyProfileProvider: (providerId: string) => void;
  setProviderParameters: Dispatch<
    SetStateAction<Record<string, Record<string, ParameterValue>>>
  >;
  setActiveProfileName: Dispatch<SetStateAction<string | null>>;
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
    profileId: string
  ) => Promise<StoreMutationResult>;
  exportConfigFn: (params: {
    repoId: string;
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
  deleteProfileById: (repoId: string, profileId: string) => Promise<void>;
  exportProfiles: (filePath: string) => Promise<void>;
  applyImportedProfiles: (profiles: ConfigProfile[]) => Promise<void>;
  handleCreateProfileFromProjectProfile: (
    sourceProfileName: string,
    parameters: Record<string, ParameterValue>
  ) => Promise<string>;
  profileManagement: ProfileManagementActions;
}

export function useProfileCrud({
  selectedRepoId,
  profiles,
  activeProfileId,
  updatePublishEditState,
  profileT,
  appT,
  activeProviderId,
  providerSchemas,
  applyProfileProvider,
  setProviderParameters,
  setActiveProfileName,
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

      if (profileProviderId !== activeProviderId) {
        applyProfileProvider(profileProviderId);
      }

      if (profile.id) {
        // 统一协议：任何 Provider 的命名配置都提交 revision 选择；
        // 编辑器视图由统一状态水合（§4.1）。
        updatePublishEditState({
          selection: {
            kind: "revision",
            configurationId: profile.id,
          },
        });
      }
      setProviderParameters((prev) => ({
        ...prev,
        [profileProviderId]: filterParametersBySchema(
          (profile.parameters || {}) as ConfigParameters,
          providerSchemas[profileProviderId]
        ),
      }));

      setActiveProfileName(profile.name);

      toast.success(appT.profileLoaded || "配置文件已加载", {
        description: `${appT.loadedProfile || "已加载配置文件"}: ${profile.name}`,
      });
    },
    [
      activeProviderId,
      applyProfileProvider,
      appT,
      providerSchemas,
      setActiveProfileName,
      setProviderParameters,
      updatePublishEditState,
    ]
  );

  const handleLoadProfile = useCallback(
    (profile: LoadableProfile) => {
      applyProfile(profile);
    },
    [applyProfile]
  );

  const deleteProfileById = useCallback(
    async (repoId: string, profileId: string) => {
      const state = await deleteProfileFromStore(repoId, profileId);
      const repo = state.repositories.find((r) => r.id === repoId);
      if (repo) {
        await refreshProfilesAfterMutation(repoId, repo.publishConfig.profiles);
      }
      if (isCurrentRepo(repoId)) {
        if (activeProfileId === profileId) {
          setActiveProfileName(null);
        }
      }
    },
    [
      activeProfileId,
      isCurrentRepo,
      refreshProfilesAfterMutation,
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
    [
      profileT.saveFailed,
      refreshProfilesAfterMutation,
      selectedRepoId,
      saveProfileToStore,
    ]
  );

  const deleteProfile = useCallback(
    async (profile: ConfigProfile) => {
      if (!selectedRepoId) {
        throw new Error(profileT.deleteFailed || "删除配置文件失败");
      }

      await deleteProfileById(selectedRepoId, profile.id);
    },
    [deleteProfileById, profileT.deleteFailed, selectedRepoId]
  );

  const exportProfiles = useCallback(
    async (filePath: string) => {
      if (!selectedRepoId) {
        throw new Error(profileT.exportFailed || "导出配置失败");
      }
      await exportConfigFn({
        repoId: selectedRepoId,
        filePath,
      });
    },
    [exportConfigFn, profileT.exportFailed, selectedRepoId]
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
    [
      profileT.importFailed,
      refreshProfilesAfterMutation,
      selectedRepoId,
      applyImportedConfigFn,
    ]
  );

  const handleCreateProfileFromProjectProfile = useCallback(
    async (
      sourceProfileName: string,
      parameters: Record<string, ParameterValue>
    ) => {
      if (!selectedRepoId) {
        throw new Error(profileT.saveFailed || "保存配置文件失败");
      }

      const existingNames = new Set(profiles.map((profile) => profile.name));
      const profileName = buildCopiedProfileName(
        sourceProfileName,
        existingNames
      );
      // 项目发布配置解析出的原始参数直接持久化，不做富表单往返。
      const state = await saveProfileToStore({
        repoId: selectedRepoId,
        name: profileName,
        providerId: "dotnet",
        parameters: parameters as ConfigParameters,
      });

      const repo = state.repositories.find((r) => r.id === selectedRepoId);
      const nextProfiles = repo
        ? await refreshProfilesAfterMutation(
            selectedRepoId,
            repo.publishConfig.profiles
          )
        : await refreshProfilesAfterMutation(selectedRepoId);
      const createdProfile = nextProfiles.find(
        (profile) => profile.name === profileName && profile.id
      );
      if (!createdProfile) {
        throw new Error("保存后未找到配置身份");
      }

      setActiveProfileName(createdProfile.name);
      updatePublishEditState({
        selection: {
          kind: "revision",
          configurationId: createdProfile.id,
        },
      });

      return profileName;
    },
    [
      profileT.saveFailed,
      profiles,
      refreshProfilesAfterMutation,
      selectedRepoId,
      setActiveProfileName,
      updatePublishEditState,
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
    deleteProfileById,
    exportProfiles,
    applyImportedProfiles,
    handleCreateProfileFromProjectProfile,
    profileManagement,
  };
}
