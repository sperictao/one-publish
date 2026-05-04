import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { toast } from "sonner";

import { mapImportedSpecByProvider } from "@/lib/commandImportMapping";
import {
  applyImportedConfig,
  deleteProfile as deleteProfileFromStore,
  exportConfig,
  getProfiles,
  reorderProfiles,
  saveProfile as saveProfileToStore,
  updateProfile,
  type ConfigParameters,
  type ConfigProfile,
  type ProfileOrderEntry,
  type PublishConfigStore,
} from "@/lib/store";
import {
  createDefaultDotnetPublishConfig,
  createDotnetPublishConfigFromParameters,
} from "@/lib/dotnetPublishConfig";
import type { Language } from "@/hooks/useI18n";
import type { ParameterSchema, ParameterValue } from "@/types/parameters";

const loadInvokeErrors = () => import("@/lib/tauri/invokeErrors");

interface TranslationMap {
  [key: string]: string | undefined;
}

interface DotnetPreset {
  id: string;
  name: string;
  description: string;
  config: {
    configuration: string;
    runtime: string;
    self_contained: boolean;
  };
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

interface ProfileListSnapshot {
  profiles: ConfigProfile[];
  revision: number;
  signature: string;
}

const EMPTY_PROFILE_LIST_SNAPSHOT: ProfileListSnapshot = {
  profiles: [],
  revision: 0,
  signature: "",
};

function buildProfileListSignature(profiles: readonly ConfigProfile[]): string {
  return profiles
    .map((profile) =>
      [profile.name, profile.providerId, profile.profileGroup || ""].join("\u0000")
    )
    .join("\u0001");
}

function createProfileListSnapshot(
  profiles: ConfigProfile[],
  previousSnapshot: ProfileListSnapshot = EMPTY_PROFILE_LIST_SNAPSHOT
): ProfileListSnapshot {
  const signature = buildProfileListSignature(profiles);
  const isSameSnapshot = previousSnapshot.signature === signature;

  return {
    profiles,
    revision:
      isSameSnapshot
        ? previousSnapshot.revision
        : previousSnapshot.revision === 0 && signature === ""
          ? 0
          : previousSnapshot.revision + 1,
    signature,
  };
}

function buildCopiedProfileName(
  sourceProfileName: string,
  existingNames: Set<string>
): string {
  const normalizedSourceName = sourceProfileName.trim() || "Profile";
  const baseName = `${normalizedSourceName}-copy`;

  if (!existingNames.has(baseName)) {
    return baseName;
  }

  let index = 2;
  while (existingNames.has(`${baseName}${index}`)) {
    index += 1;
  }

  return `${baseName}${index}`;
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
  const [visibleProfilesSnapshot, setVisibleProfilesSnapshot] =
    useState<ProfileListSnapshot>(EMPTY_PROFILE_LIST_SNAPSHOT);
  const [isProfilesRefreshing, setIsProfilesRefreshing] = useState(false);
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
  const loadProfilesRequestIdRef = useRef(0);
  const reorderProfilesQueueRef = useRef<Promise<void>>(Promise.resolve());
  const profilesCacheRef = useRef<Record<string, ProfileListSnapshot>>({});
  const selectedRepoIdRef = useRef(selectedRepoId);
  const profiles = visibleProfilesSnapshot.profiles;
  const profilesRevision = visibleProfilesSnapshot.revision;
  selectedRepoIdRef.current = selectedRepoId;

  const commitProfilesSnapshot = useCallback(
    (repoId: string, nextProfiles: ConfigProfile[]) => {
      const previousSnapshot =
        profilesCacheRef.current[repoId] ?? EMPTY_PROFILE_LIST_SNAPSHOT;
      const nextSnapshot = createProfileListSnapshot(nextProfiles, previousSnapshot);

      profilesCacheRef.current[repoId] = nextSnapshot;

      if (selectedRepoIdRef.current === repoId) {
        setVisibleProfilesSnapshot(nextSnapshot);
      }

      return nextSnapshot;
    },
    []
  );

  const loadProfiles = useCallback(async () => {
    const requestId = loadProfilesRequestIdRef.current + 1;
    loadProfilesRequestIdRef.current = requestId;
    const repoId = selectedRepoId;

    if (!repoId) {
      setVisibleProfilesSnapshot(EMPTY_PROFILE_LIST_SNAPSHOT);
      setIsProfilesRefreshing(false);
      return [];
    }

    const cachedSnapshot =
      profilesCacheRef.current[repoId] ?? EMPTY_PROFILE_LIST_SNAPSHOT;
    setVisibleProfilesSnapshot(cachedSnapshot);
    setIsProfilesRefreshing(true);

    try {
      const data = await getProfiles(repoId);

      if (
        loadProfilesRequestIdRef.current !== requestId ||
        selectedRepoIdRef.current !== repoId
      ) {
        return data;
      }

      commitProfilesSnapshot(repoId, data);
      setIsProfilesRefreshing(false);
      return data;
    } catch (err) {
      if (
        loadProfilesRequestIdRef.current === requestId &&
        selectedRepoIdRef.current === repoId
      ) {
        setVisibleProfilesSnapshot(cachedSnapshot);
        setIsProfilesRefreshing(false);
      }
      console.error("加载配置文件列表失败:", err);
      return [];
    }
  }, [commitProfilesSnapshot, selectedRepoId]);

  const refreshProfilesAfterMutation = useCallback(
    async (repoId: string) => {
      if (selectedRepoIdRef.current === repoId) {
        return await loadProfiles();
      }

      const data = await getProfiles(repoId);
      commitProfilesSnapshot(repoId, data);
      return data;
    },
    [commitProfilesSnapshot, loadProfiles]
  );

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  useLayoutEffect(() => {
    const cachedSnapshot = selectedRepoId
      ? profilesCacheRef.current[selectedRepoId] ?? EMPTY_PROFILE_LIST_SNAPSHOT
      : EMPTY_PROFILE_LIST_SNAPSHOT;

    setVisibleProfilesSnapshot(cachedSnapshot);
    setIsProfilesRefreshing(Boolean(selectedRepoId));
    setActiveProfileName(null);
    setEditingProfileOriginalName(null);
  }, [selectedRepoId]);

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
      setSelectedPreset(`profile-${profileName}`);
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
      const nextProfileKey = `userprofile:${profileName}`;

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
          `userprofile:${editingProfileOriginalName}`,
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

      if (selectedRepoIdRef.current === repoId) {
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

  const handleReorderProfiles = useCallback(
    (nextProfiles: ConfigProfile[]) => {
      if (!selectedRepoId) {
        return;
      }

      const repoId = selectedRepoId;
      const nextProfileOrder: ProfileOrderEntry[] = nextProfiles.map((profile) => ({
        name: profile.name,
        profileGroup: profile.profileGroup ?? null,
      }));

      commitProfilesSnapshot(repoId, nextProfiles);

      reorderProfilesQueueRef.current = reorderProfilesQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          try {
            await reorderProfiles({
              repoId,
              profiles: nextProfileOrder,
            });
          } catch (err) {
            console.error("保存配置排序失败:", err);

            if (selectedRepoIdRef.current === repoId) {
              await loadProfiles();
            }

            const { extractInvokeErrorMessage } = await loadInvokeErrors();
            toast.error(profileT.quickEditFailed || "更新配置文件失败", {
              description: extractInvokeErrorMessage(err),
            });
          }
        });
    },
    [commitProfilesSnapshot, loadProfiles, profileT.quickEditFailed, selectedRepoId]
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
    handleReorderProfiles,
    profileManagement,
  };
}
