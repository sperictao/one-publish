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
import type { ConfigProfile } from "@/lib/store/types";
import type { Language } from "@/hooks/useI18n";
import type { Repository } from "@/lib/store/types";
import type { ParameterSchema, ParameterValue } from "@/types/parameters";
import type {
  ProviderTemplateSummary,
  PublishEditStateUpdate,
} from "@/generated/tauri-contracts";
import type { TranslationMap, ProfileManagementActions } from "./types";

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
  getActiveProfileIdFromSelection,
  resolvePublishSelectionIdentity,
} from "./publishConfigIdentity";

interface UseProfilesParams {
  backendTemplates?: ProviderTemplateSummary[];
  appT: TranslationMap;
  profileT: TranslationMap;
  language: Language;
  selectedRepoId: string | null;
  activeProviderId: string;
  providerSchemas: Record<string, ParameterSchema>;
  applyProfileProvider: (providerId: string) => void;
  updatePublishEditState: (update: PublishEditStateUpdate) => void;
  selectedRepo: Repository | null;
  setProviderParameters: Dispatch<
    SetStateAction<Record<string, Record<string, ParameterValue>>>
  >;
  replaceScopedConfigKey: (
    previousKey: string,
    nextKey: string,
    repoId?: string | null
  ) => void;
}

export function useProfiles({
  backendTemplates = [],
  appT,
  profileT,
  language,
  selectedRepoId,
  activeProviderId,
  providerSchemas,
  applyProfileProvider,
  updatePublishEditState,
  selectedRepo,
  setProviderParameters,
}: UseProfilesParams) {
  const [localActiveProfileName, setLocalActiveProfileName] = useState<
    string | null
  >(null);
  const selectionIdentity = useMemo(
    () =>
      resolvePublishSelectionIdentity({
        activeProviderId,
        selection: selectedRepo?.publishConfig.selection,
      }),
    [activeProviderId, selectedRepo]
  );
  const persistedActiveProfileId =
    getActiveProfileIdFromSelection(selectionIdentity);
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
  const activeProfileName =
    activeProviderId === "dotnet"
      ? (profiles.find((profile) => profile.id === persistedActiveProfileId)
          ?.name ?? null)
      : localActiveProfileName;

  const crud = useProfileCrud({
    selectedRepoId,
    profiles,
    activeProfileId: persistedActiveProfileId,
    profileT,
    appT,
    activeProviderId,
    providerSchemas,
    applyProfileProvider,
    setProviderParameters,
    setActiveProfileName: setLocalActiveProfileName,
    refreshProfilesAfterMutation,
    isCurrentRepo,
    saveProfileToStore,
    deleteProfileFromStore,
    exportConfigFn: exportConfig,
    applyImportedConfigFn: applyImportedConfig,
    updatePublishEditState,
  });

  const selection = useProfileSelection({
    updatePublishEditState,
    setActiveProfileName: setLocalActiveProfileName,
    applyProfile: crud.applyProfile,
  });

  const quickCreate = useQuickCreateProfile({
    backendTemplates,
    projectBinding:
      selectedRepo?.publishConfig.selection?.kind === "draft"
        ? selectedRepo.publishConfig.selection.projectBinding
        : (profiles.find((profile) => profile.id === persistedActiveProfileId)
            ?.projectBinding ?? null),
    selectedRepoId,
    activeProviderId,
    profileT,
    profiles,
    language,
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
    async (profileId: string) => {
      if (!selectedRepoId) {
        return;
      }

      try {
        await crud.deleteProfileById(selectedRepoId, profileId);
      } catch (err) {
        console.error("删除配置文件失败:", err);
      }
    },
    [crud.deleteProfileById, selectedRepoId]
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
    setQuickCreateProfileCustomGroup:
      quickCreate.setQuickCreateProfileCustomGroup,
    quickCreateProfileSaving: quickCreate.quickCreateProfileSaving,
    isQuickCreateEditing: quickCreate.isQuickCreateEditing,
    isQuickCreateViewing: quickCreate.isQuickCreateViewing,
    loadProfiles,
    setActiveProfileName: setLocalActiveProfileName,
    openQuickCreateProfileDialog: quickCreate.openQuickCreateProfileDialog,
    openQuickEditProfileDialog: quickCreate.openQuickEditProfileDialog,
    openQuickViewProfileDialog: quickCreate.openQuickViewProfileDialog,
    handleQuickCreateProfileOpenChange:
      quickCreate.handleQuickCreateProfileOpenChange,
    quickCreateTemplateOptions: quickCreate.quickCreateTemplateOptions,
    quickCreateProfileGroupOptions: quickCreate.quickCreateProfileGroupOptions,
    applyQuickCreateTemplate: quickCreate.applyQuickCreateTemplate,
    updateQuickCreateProfileParameter:
      quickCreate.updateQuickCreateProfileParameter,
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
