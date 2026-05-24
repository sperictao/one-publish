import {
  useCallback,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { toast } from "sonner";

import { mapImportedSpecByProvider } from "@/lib/commandImportMapping";
import {
  createProjectProfileSelectedPreset,
  createUserProfileConfigKey,
} from "@/lib/publishConfigIdentity";
import {
  applyImportedConfig,
  deleteProfile as deleteProfileFromStore,
  exportConfig,
  saveProfile as saveProfileToStore,
  updateProfile,
  type ConfigParameters,
  type ConfigProfile,
  type PublishConfigStore,
} from "@/lib/store";
import {
  createDefaultDotnetPublishConfig,
  createDotnetPublishConfigFromParameters,
} from "@/lib/dotnetPublishConfig";
import type { DotnetPreset } from "@/lib/dotnetPresets";
import { buildCopiedProfileName } from "@/lib/profileListSnapshot";
import type { Language } from "@/hooks/useI18n";
import { useProfileListState } from "@/hooks/useProfileListState";
import type { ParameterSchema, ParameterValue } from "@/types/parameters";

const loadInvokeErrors = () => import("@/lib/tauri/invokeErrors");

interface TranslationMap {
  [key: string]: string | undefined;
}

interface QuickCreateTemplateOption {
  id: string;
  name: string;
  description: string;
}

interface LoadableProfile {
  name: string;
  providerId?: string;
  provider_id?: string;
  parameters?: Record<string, unknown>;
}

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

export interface ProfileManagementSaveParams {
  name: string;
  providerId: string;
  parameters: ConfigParameters;
  profileGroup?: string;
}

export interface ProfileManagementActions {
  profiles: ConfigProfile[];
  isRefreshing: boolean;
  refreshProfiles: () => Promise<ConfigProfile[]>;
  saveProfile: (params: ProfileManagementSaveParams) => Promise<void>;
  deleteProfile: (profile: ConfigProfile) => Promise<void>;
  exportProfiles: (filePath: string) => Promise<void>;
  applyImportedProfiles: (profiles: ConfigProfile[]) => Promise<void>;
}

export const QUICK_CREATE_CUSTOM_TEMPLATE_ID = "custom";
export const QUICK_CREATE_PROFILE_GROUP_DEFAULT = "__default__";
export const QUICK_CREATE_PROFILE_GROUP_CUSTOM = "__custom__";

const toDotnetCustomConfigDraftFromPreset = (
  preset: DotnetPreset
): PublishConfigStore => ({
  ...createDefaultDotnetPublishConfig(),
  configuration: preset.config.configuration,
  runtime: preset.config.runtime,
  selfContained: preset.config.self_contained,
});

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
  setSelectedPreset,
  setProviderParameters,
  applyDotnetCustomConfig,
  replaceScopedConfigKey,
  presets,
  defaultPresetId,
  getPresetText,
  buildProfileParameters,
}: UseProfilesParams) {
  const [activeProfileName, setActiveProfileName] = useState<string | null>(null);
  const [quickCreateProfileOpen, setQuickCreateProfileOpen] = useState(false);
  const [quickCreateProfileName, setQuickCreateProfileName] = useState("");
  const [quickCreateTemplateId, setQuickCreateTemplateId] = useState(
    QUICK_CREATE_CUSTOM_TEMPLATE_ID
  );
  const [quickCreateProfileDraft, setQuickCreateProfileDraft] =
    useState<PublishConfigStore>(() => createDefaultDotnetPublishConfig());
  const [quickCreateProfileGroup, setQuickCreateProfileGroup] = useState(
    QUICK_CREATE_PROFILE_GROUP_DEFAULT
  );
  const [quickCreateProfileCustomGroup, setQuickCreateProfileCustomGroup] =
    useState("");
  const [quickCreateProfileSaving, setQuickCreateProfileSaving] = useState(false);
  const [editingProfileOriginalName, setEditingProfileOriginalName] = useState<string | null>(null);

  const handleRepositoryScopeChange = useCallback(() => {
    setActiveProfileName(null);
    setEditingProfileOriginalName(null);
  }, []);

  const {
    profiles,
    profilesRevision,
    isProfilesRefreshing,
    loadProfiles,
    refreshProfilesAfterMutation,
    reorderVisibleProfiles,
    isCurrentRepo,
  } = useProfileListState({
    selectedRepoId,
    profileT,
    onRepositoryScopeChange: handleRepositoryScopeChange,
  });

  const resetQuickCreateProfileState = useCallback(() => {
    setQuickCreateProfileName("");
    setQuickCreateTemplateId(QUICK_CREATE_CUSTOM_TEMPLATE_ID);
    setQuickCreateProfileDraft(createDefaultDotnetPublishConfig());
    setQuickCreateProfileGroup(QUICK_CREATE_PROFILE_GROUP_DEFAULT);
    setQuickCreateProfileCustomGroup("");
    setQuickCreateProfileSaving(false);
    setEditingProfileOriginalName(null);
  }, []);

  const openQuickCreateProfileDialog = useCallback(() => {
    resetQuickCreateProfileState();
    setQuickCreateProfileOpen(true);
  }, [resetQuickCreateProfileState]);

  const handleQuickCreateProfileOpenChange = useCallback((open: boolean) => {
    setQuickCreateProfileOpen(open);
    if (!open) {
      resetQuickCreateProfileState();
    }
  }, [resetQuickCreateProfileState]);

  const openQuickEditProfileDialog = useCallback((profile: ConfigProfile) => {
    if (profile.isSystemDefault || profile.providerId !== "dotnet") {
      return;
    }

    const parameters = profile.parameters || {};
    const resolvedGroup = profile.profileGroup?.trim() || "";

    setQuickCreateProfileName(profile.name);
    setQuickCreateTemplateId(QUICK_CREATE_CUSTOM_TEMPLATE_ID);
    setQuickCreateProfileDraft(
      createDotnetPublishConfigFromParameters(
        parameters as Record<string, unknown>
      )
    );
    setQuickCreateProfileGroup(
      resolvedGroup || QUICK_CREATE_PROFILE_GROUP_DEFAULT
    );
    setQuickCreateProfileCustomGroup("");
    setQuickCreateProfileSaving(false);
    setEditingProfileOriginalName(profile.name);
    setQuickCreateProfileOpen(true);
  }, []);

  const quickCreateTemplateOptions = useMemo<QuickCreateTemplateOption[]>(
    () => [
      {
        id: QUICK_CREATE_CUSTOM_TEMPLATE_ID,
        name: profileT.quickCreateTemplateCustom || "自定义配置（空表单）",
        description: "",
      },
      ...presets.map((preset) => {
        const presetText = getPresetText(
          preset.id,
          preset.name,
          preset.description
        );

        return {
          id: preset.id,
          name: presetText.name,
          description: presetText.description,
        };
      }),
    ],
    [getPresetText, presets, profileT.quickCreateTemplateCustom]
  );

  const quickCreateProfileGroupOptions = useMemo(() => {
    const groupSet = new Set(
      profiles
        .map((profile) => profile.profileGroup?.trim() || "")
        .filter(
          (value) =>
            value.length > 0 &&
            value !== QUICK_CREATE_PROFILE_GROUP_DEFAULT &&
            value !== QUICK_CREATE_PROFILE_GROUP_CUSTOM
        )
    );

    return Array.from(groupSet).sort((left, right) =>
      left.localeCompare(right, language === "en" ? "en" : "zh-CN")
    );
  }, [profiles, language]);

  const applyQuickCreateTemplate = useCallback((templateId: string) => {
    setQuickCreateTemplateId(templateId);

    if (templateId === QUICK_CREATE_CUSTOM_TEMPLATE_ID) {
      setQuickCreateProfileDraft(createDefaultDotnetPublishConfig());
      return;
    }

    const matchedPreset = presets.find((preset) => preset.id === templateId);
    if (!matchedPreset) {
      setQuickCreateTemplateId(QUICK_CREATE_CUSTOM_TEMPLATE_ID);
      setQuickCreateProfileDraft(createDefaultDotnetPublishConfig());
      return;
    }

    setQuickCreateProfileDraft(toDotnetCustomConfigDraftFromPreset(matchedPreset));
  }, [presets]);

  const updateQuickCreateProfileDraft = useCallback(
    (updates: Partial<PublishConfigStore>) => {
      setQuickCreateTemplateId(QUICK_CREATE_CUSTOM_TEMPLATE_ID);
      setQuickCreateProfileDraft((prev) => ({ ...prev, ...updates }));
    },
    []
  );

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
      setProviderParameters,
    ]
  );

  const handleSelectProjectProfile = useCallback(
    (profileName: string) => {
      setSelectedPreset(createProjectProfileSelectedPreset(profileName));
      setIsCustomMode(false);
      setActiveProfileName(null);
    },
    [setIsCustomMode, setSelectedPreset]
  );

  const handleSelectProfileFromPanel = useCallback(
    (profile: ConfigProfile) => {
      setActiveProfileName(profile.name);
      applyProfile(profile);
    },
    [applyProfile]
  );

  const handleQuickCreateProfileSave = useCallback(async () => {
    if (!selectedRepoId) {
      return;
    }

    const profileName = quickCreateProfileName.trim();
    if (!profileName) {
      toast.error(profileT.enterProfileName || "请输入配置文件名称");
      return;
    }

    const resolvedProfileGroup =
      quickCreateProfileGroup === QUICK_CREATE_PROFILE_GROUP_DEFAULT
        ? ""
        : quickCreateProfileGroup === QUICK_CREATE_PROFILE_GROUP_CUSTOM
          ? quickCreateProfileCustomGroup.trim()
          : quickCreateProfileGroup.trim();

    if (
      quickCreateProfileGroup === QUICK_CREATE_PROFILE_GROUP_CUSTOM &&
      !resolvedProfileGroup
    ) {
      toast.error(profileT.enterProfileGroup || "请输入发布配置组名称");
      return;
    }

    if (quickCreateProfileSaving) {
      return;
    }

    setQuickCreateProfileSaving(true);

    try {
      const parameters = buildProfileParameters(quickCreateProfileDraft);
      const isEditing = Boolean(editingProfileOriginalName);
      const nextProfileKey = createUserProfileConfigKey(profileName);

      if (editingProfileOriginalName) {
        await updateProfile({
          repoId: selectedRepoId,
          originalName: editingProfileOriginalName,
          name: profileName,
          providerId: "dotnet",
          parameters,
          profileGroup: resolvedProfileGroup || undefined,
        });
      } else {
        await saveProfileToStore({
          repoId: selectedRepoId,
          name: profileName,
          providerId: "dotnet",
          parameters,
          profileGroup: resolvedProfileGroup || undefined,
        });
      }

      await refreshProfilesAfterMutation(selectedRepoId);

      handleSelectProfileFromPanel({
        name: profileName,
        providerId: "dotnet",
        parameters,
        profileGroup: resolvedProfileGroup || undefined,
        createdAt: new Date().toISOString(),
        isSystemDefault: false,
      });
      if (
        editingProfileOriginalName &&
        editingProfileOriginalName !== profileName
      ) {
        replaceScopedConfigKey(
          createUserProfileConfigKey(editingProfileOriginalName),
          nextProfileKey,
          selectedRepoId
        );
      }

      toast.success(
        isEditing
          ? profileT.quickEditSuccess || "配置文件更新成功"
          : profileT.saveSuccess || "配置文件保存成功"
      );
      handleQuickCreateProfileOpenChange(false);
    } catch (err) {
      const { extractInvokeErrorMessage } = await loadInvokeErrors();
      console.error("保存配置文件失败:", err);
      toast.error(
        extractInvokeErrorMessage(err) ||
          (editingProfileOriginalName
            ? profileT.quickEditFailed || "更新配置文件失败"
            : profileT.saveFailed || "保存配置文件失败")
      );
    } finally {
      setQuickCreateProfileSaving(false);
    }
  }, [
    buildProfileParameters,
    editingProfileOriginalName,
    handleQuickCreateProfileOpenChange,
    handleSelectProfileFromPanel,
    profileT,
    quickCreateProfileCustomGroup,
    quickCreateProfileDraft,
    quickCreateProfileGroup,
    quickCreateProfileName,
    quickCreateProfileSaving,
    replaceScopedConfigKey,
    refreshProfilesAfterMutation,
    selectedRepoId,
  ]);

  const deleteProfileByName = useCallback(
    async (repoId: string, name: string) => {
      await deleteProfileFromStore(repoId, name);
      await refreshProfilesAfterMutation(repoId);

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
    ]
  );

  const handleDeleteProfileFromPanel = useCallback(
    async (name: string) => {
      if (!selectedRepoId) {
        return;
      }

      try {
        await deleteProfileByName(selectedRepoId, name);
      } catch (err) {
        console.error("删除配置文件失败:", err);
      }
    },
    [
      deleteProfileByName,
      selectedRepoId,
    ]
  );

  const saveProfileFromManagement = useCallback(
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

      await saveProfileToStore({
        repoId,
        name,
        providerId,
        parameters,
        profileGroup,
      });
      await refreshProfilesAfterMutation(repoId);
    },
    [profileT.saveFailed, refreshProfilesAfterMutation, selectedRepoId]
  );

  const deleteProfileFromManagement = useCallback(
    async (profile: ConfigProfile) => {
      if (!selectedRepoId) {
        throw new Error(profileT.deleteFailed || "删除配置文件失败");
      }

      await deleteProfileByName(selectedRepoId, profile.name);
    },
    [deleteProfileByName, profileT.deleteFailed, selectedRepoId]
  );

  const exportProfilesFromManagement = useCallback(
    async (filePath: string) => {
      await exportConfig({
        profiles,
        filePath,
      });
    },
    [profiles]
  );

  const applyImportedProfilesFromManagement = useCallback(
    async (importedProfiles: ConfigProfile[]) => {
      if (!selectedRepoId) {
        throw new Error(profileT.importFailed || "导入配置失败");
      }

      const repoId = selectedRepoId;

      await applyImportedConfig(repoId, importedProfiles);
      await refreshProfilesAfterMutation(repoId);
    },
    [profileT.importFailed, refreshProfilesAfterMutation, selectedRepoId]
  );

  const handleLoadProfile = useCallback(
    (profile: LoadableProfile) => {
      applyProfile(profile);
    },
    [applyProfile]
  );

  const handleCreateProfileFromProjectProfile = useCallback(
    async (sourceProfileName: string, config: PublishConfigStore) => {
      if (!selectedRepoId) {
        throw new Error(profileT.saveFailed || "保存配置文件失败");
      }

      const existingNames = new Set(profiles.map((profile) => profile.name));
      const profileName = buildCopiedProfileName(sourceProfileName, existingNames);
      const parameters = buildProfileParameters(config);

      await saveProfileToStore({
        repoId: selectedRepoId,
        name: profileName,
        providerId: "dotnet",
        parameters,
      });

      await refreshProfilesAfterMutation(selectedRepoId);

      setActiveProfileName(profileName);
      applyDotnetCustomConfig(config);

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
    ]
  );

  const profileManagement = useMemo<ProfileManagementActions>(
    () => ({
      profiles,
      isRefreshing: isProfilesRefreshing,
      refreshProfiles: loadProfiles,
      saveProfile: saveProfileFromManagement,
      deleteProfile: deleteProfileFromManagement,
      exportProfiles: exportProfilesFromManagement,
      applyImportedProfiles: applyImportedProfilesFromManagement,
    }),
    [
      applyImportedProfilesFromManagement,
      deleteProfileFromManagement,
      exportProfilesFromManagement,
      isProfilesRefreshing,
      loadProfiles,
      profiles,
      saveProfileFromManagement,
    ]
  );

  return {
    profiles,
    profilesRevision,
    isProfilesRefreshing,
    activeProfileName,
    quickCreateProfileOpen,
    quickCreateProfileName,
    setQuickCreateProfileName,
    quickCreateTemplateId,
    quickCreateProfileDraft,
    quickCreateProfileGroup,
    setQuickCreateProfileGroup,
    quickCreateProfileCustomGroup,
    setQuickCreateProfileCustomGroup,
    quickCreateProfileSaving,
    isQuickCreateEditing: editingProfileOriginalName !== null,
    loadProfiles,
    setActiveProfileName,
    openQuickCreateProfileDialog,
    openQuickEditProfileDialog,
    handleQuickCreateProfileOpenChange,
    quickCreateTemplateOptions,
    quickCreateProfileGroupOptions,
    applyQuickCreateTemplate,
    updateQuickCreateProfileDraft,
    handleSelectProjectProfile,
    handleSelectProfileFromPanel,
    handleQuickCreateProfileSave,
    handleDeleteProfileFromPanel,
    handleLoadProfile,
    handleCreateProfileFromProjectProfile,
    handleReorderProfiles: reorderVisibleProfiles,
    profileManagement,
  };
}
