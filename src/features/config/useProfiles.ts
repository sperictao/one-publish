import {
  useCallback,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import { useProfileListState } from "@/hooks/useProfileListState";
import {
  applyImportedConfig,
  deleteProfile as deleteProfileFromStore,
  exportConfig,
  reorderProfiles,
  saveProfile as saveProfileToStore,
  updateProfile,
} from "@/lib/store/api";
import type {
  ConfigParameters,
  ConfigProfile,
  PublishConfigStore,
} from "@/lib/store/types";
import type { DotnetPreset } from "@/features/config/dotnetPresets";
import type { Language } from "@/hooks/useI18n";
import type { ParameterSchema, ParameterValue } from "@/types/parameters";
import type {
  TranslationMap,
  ProfileManagementActions,
} from "./types";

// Re-export types and constants for backward compatibility
export type {
  TranslationMap,
  LoadableProfile,
  ProfileManagementSaveParams,
  ProfileManagementActions,
} from "./types";
export {
  QUICK_CREATE_CUSTOM_TEMPLATE_ID,
  QUICK_CREATE_PROFILE_GROUP_DEFAULT,
  QUICK_CREATE_PROFILE_GROUP_CUSTOM,
} from "./types";

export type { QuickCreateTemplateOption } from "./types";

import { useProfileCrud } from "./useProfileCrud";
import { useQuickCreateProfile } from "./useQuickCreateProfile";
import { useProfileOrdering } from "./useProfileOrdering";
import { useProfileSelection } from "./useProfileSelection";
import {
  getActiveProfileNameFromSelection,
  resolvePublishSelectionIdentity,
} from "./publishConfigIdentity";

interface UseProfilesParams {
  appT: TranslationMap;
  profileT: TranslationMap;
  language: Language;
  selectedRepoId: string | null;
  activeProviderId: string;
  providerSchemas: Record<string, ParameterSchema>;
  applyProfileProvider: (providerId: string) => void;
  setIsCustomMode: (value: boolean) => void;
  isCustomMode: boolean;
  selectedPreset: string;
  setSelectedPreset: (value: string) => void;
  setProviderParameters: Dispatch<
    SetStateAction<Record<string, Record<string, ParameterValue>>>
  >;
  applyDotnetCustomConfig: (config: PublishConfigStore) => void;
  replaceScopedConfigKey: (
    previousKey: string,
    nextKey: string,
    repoId?: string | null
  ) => void;
  presets: DotnetPreset[];
  defaultPresetId: string;
  getPresetText: (
    presetId: string,
    fallbackName: string,
    fallbackDescription: string
  ) => {
    name: string;
    description: string;
  };
  buildProfileParameters: (config: PublishConfigStore) => ConfigParameters;
}

export function useProfiles({
  appT,
  profileT,
  language,
  selectedRepoId,
  activeProviderId,
  providerSchemas,
  applyProfileProvider,
  setIsCustomMode,
  isCustomMode,
  selectedPreset,
  setSelectedPreset,
  setProviderParameters,
  applyDotnetCustomConfig,
  replaceScopedConfigKey,
  presets,
  defaultPresetId,
  getPresetText,
  buildProfileParameters,
}: UseProfilesParams) {
  const [localActiveProfileName, setLocalActiveProfileName] =
    useState<string | null>(null);
  const selectionIdentity = useMemo(
    () =>
      resolvePublishSelectionIdentity({
        activeProviderId,
        isCustomMode,
        selectedPreset,
      }),
    [activeProviderId, isCustomMode, selectedPreset]
  );
  const persistedActiveProfileName =
    getActiveProfileNameFromSelection(selectionIdentity);
  const activeProfileName =
    activeProviderId === "dotnet"
      ? persistedActiveProfileName
      : localActiveProfileName;

  const handleRepositoryScopeChange = useCallback(() => {
    setLocalActiveProfileName(null);
  }, []);

  const {
    profiles,
    profilesRevision,
    isProfilesRefreshing,
    loadProfiles,
    refreshProfilesAfterMutation,
    isCurrentRepo,
    commitProfilesSnapshot,
  } = useProfileListState({
    selectedRepoId,
    profileT,
    onRepositoryScopeChange: handleRepositoryScopeChange,
  });

  const crud = useProfileCrud({
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
    setActiveProfileName: setLocalActiveProfileName,
    buildProfileParameters,
    refreshProfilesAfterMutation,
    isCurrentRepo,
    saveProfileToStore,
    deleteProfileFromStore,
    exportConfigFn: exportConfig,
    applyImportedConfigFn: applyImportedConfig,
  });

  const selection = useProfileSelection({
    setIsCustomMode,
    setSelectedPreset,
    setActiveProfileName: setLocalActiveProfileName,
    applyProfile: crud.applyProfile,
  });

  const quickCreate = useQuickCreateProfile({
    selectedRepoId,
    profileT,
    presets,
    profiles,
    language,
    getPresetText,
    buildProfileParameters,
    replaceScopedConfigKey,
    refreshProfilesAfterMutation,
    saveProfileToStore,
    updateProfile,
    onProfileSaved: selection.handleSelectProfileFromPanel,
  });

  const handleOptimisticReorder = useCallback(
    (nextProfiles: ConfigProfile[]) => {
      if (selectedRepoId) {
        commitProfilesSnapshot(selectedRepoId, nextProfiles);
      }
    },
    [selectedRepoId, commitProfilesSnapshot]
  );

  const handleReorderFailed = useCallback(async () => {
    await loadProfiles();
  }, [loadProfiles]);

  const { reorderVisibleProfiles } = useProfileOrdering({
    selectedRepoId,
    onOptimisticUpdate: handleOptimisticReorder,
    onReorderFailed: handleReorderFailed,
    reorderProfilesFn: reorderProfiles,
    profileT,
  });

  const handleDeleteProfileFromPanel = useCallback(
    async (name: string) => {
      if (!selectedRepoId) {
        return;
      }

      try {
        await crud.deleteProfileByName(selectedRepoId, name);
      } catch (err) {
        console.error("删除配置文件失败:", err);
      }
    },
    [crud.deleteProfileByName, selectedRepoId]
  );

  const profileManagement = useMemo<ProfileManagementActions>(
    () => ({
      profiles,
      isRefreshing: isProfilesRefreshing,
      refreshProfiles: loadProfiles,
      saveProfile: crud.saveProfile,
      deleteProfile: crud.deleteProfile,
      exportProfiles: crud.exportProfiles,
      applyImportedProfiles: crud.applyImportedProfiles,
    }),
    [
      crud.applyImportedProfiles,
      crud.deleteProfile,
      crud.exportProfiles,
      crud.saveProfile,
      isProfilesRefreshing,
      loadProfiles,
      profiles,
    ]
  );

  return {
    profiles,
    profilesRevision,
    isProfilesRefreshing,
    activeProfileName,
    quickCreateProfileOpen: quickCreate.quickCreateProfileOpen,
    quickCreateProfileName: quickCreate.quickCreateProfileName,
    setQuickCreateProfileName: quickCreate.setQuickCreateProfileName,
    quickCreateTemplateId: quickCreate.quickCreateTemplateId,
    quickCreateProfileDraft: quickCreate.quickCreateProfileDraft,
    quickCreateProfileGroup: quickCreate.quickCreateProfileGroup,
    setQuickCreateProfileGroup: quickCreate.setQuickCreateProfileGroup,
    quickCreateProfileCustomGroup: quickCreate.quickCreateProfileCustomGroup,
    setQuickCreateProfileCustomGroup: quickCreate.setQuickCreateProfileCustomGroup,
    quickCreateProfileSaving: quickCreate.quickCreateProfileSaving,
    isQuickCreateEditing: quickCreate.isQuickCreateEditing,
    loadProfiles,
    setActiveProfileName: setLocalActiveProfileName,
    openQuickCreateProfileDialog: quickCreate.openQuickCreateProfileDialog,
    openQuickEditProfileDialog: quickCreate.openQuickEditProfileDialog,
    handleQuickCreateProfileOpenChange: quickCreate.handleQuickCreateProfileOpenChange,
    quickCreateTemplateOptions: quickCreate.quickCreateTemplateOptions,
    quickCreateProfileGroupOptions: quickCreate.quickCreateProfileGroupOptions,
    applyQuickCreateTemplate: quickCreate.applyQuickCreateTemplate,
    updateQuickCreateProfileDraft: quickCreate.updateQuickCreateProfileDraft,
    handleSelectProjectProfile: selection.handleSelectProjectProfile,
    handleSelectProfileFromPanel: selection.handleSelectProfileFromPanel,
    handleQuickCreateProfileSave: quickCreate.handleQuickCreateProfileSave,
    handleDeleteProfileFromPanel,
    handleLoadProfile: crud.handleLoadProfile,
    handleCreateProfileFromProjectProfile:
      crud.handleCreateProfileFromProjectProfile,
    handleReorderProfiles: reorderVisibleProfiles,
    profileManagement,
  };
}
