import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { toast } from "sonner";

import { mapImportedSpecByProvider } from "@/lib/commandImportMapping";
import {
  deleteProfile,
  getProfiles,
  saveProfile,
  updateProfile,
  type ConfigProfile,
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
  setActiveProviderId: (value: string) => void;
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
  buildProfileParameters: (config: PublishConfigStore) => Record<string, unknown>;
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
  setActiveProviderId,
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
  const [profiles, setProfiles] = useState<ConfigProfile[]>([]);
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
  const selectedRepoIdRef = useRef(selectedRepoId);

  useEffect(() => {
    selectedRepoIdRef.current = selectedRepoId;
  }, [selectedRepoId]);

  const loadProfiles = useCallback(async () => {
    const requestId = loadProfilesRequestIdRef.current + 1;
    loadProfilesRequestIdRef.current = requestId;
    const repoId = selectedRepoId;

    if (!repoId) {
      setProfiles([]);
      return [];
    }

    try {
      const data = await getProfiles(repoId);

      if (
        loadProfilesRequestIdRef.current !== requestId ||
        selectedRepoIdRef.current !== repoId
      ) {
        return data;
      }

      setProfiles(data);
      return data;
    } catch (err) {
      if (
        loadProfilesRequestIdRef.current === requestId &&
        selectedRepoIdRef.current === repoId
      ) {
        setProfiles([]);
      }
      console.error("加载配置文件列表失败:", err);
      return [];
    }
  }, [selectedRepoId]);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    setProfiles([]);
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
        setActiveProviderId(profileProviderId);
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
      applyDotnetCustomConfig,
      appT,
      providerSchemas,
      setActiveProviderId,
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
        await saveProfile({
          repoId: selectedRepoId,
          name: profileName,
          providerId: "dotnet",
          parameters,
          profileGroup: resolvedProfileGroup || undefined,
        });
      }

      await loadProfiles();

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
    loadProfiles,
    profileT,
    quickCreateProfileCustomGroup,
    quickCreateProfileDraft,
    quickCreateProfileGroup,
    quickCreateProfileName,
    quickCreateProfileSaving,
    replaceScopedConfigKey,
    selectedRepoId,
  ]);

  const handleDeleteProfileFromPanel = useCallback(
    async (name: string) => {
      if (!selectedRepoId) {
        return;
      }

      try {
        await deleteProfile(selectedRepoId, name);
        await loadProfiles();
        if (activeProfileName === name) {
          setActiveProfileName(null);
          if (isCustomMode) {
            setIsCustomMode(false);
            setSelectedPreset(defaultPresetId);
          }
        }
      } catch (err) {
        console.error("删除配置文件失败:", err);
      }
    },
    [
      activeProfileName,
      defaultPresetId,
      isCustomMode,
      loadProfiles,
      selectedRepoId,
      setIsCustomMode,
      setSelectedPreset,
    ]
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

      await saveProfile({
        repoId: selectedRepoId,
        name: profileName,
        providerId: "dotnet",
        parameters,
      });

      await loadProfiles();

      setActiveProfileName(profileName);
      applyDotnetCustomConfig(config);

      return profileName;
    },
    [
      applyDotnetCustomConfig,
      buildProfileParameters,
      loadProfiles,
      profileT.saveFailed,
      profiles,
      selectedRepoId,
      setActiveProfileName,
    ]
  );

  return {
    profiles,
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
  };
}
