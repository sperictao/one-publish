import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import {
  getProfiles,
  type ConfigProfile,
  type PublishConfigStore,
} from "@/lib/store";
import type { Language } from "@/hooks/useI18n";
import type { ParameterSchema, ParameterValue } from "@/types/parameters";

const loadProfilesRuntime = () => import("@/hooks/useProfiles.runtime");

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

interface DotnetCustomConfigDraft {
  configuration: string;
  runtime: string;
  outputDir: string;
  selfContained: boolean;
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
  setActiveProviderId: (value: string) => void;
  setIsCustomMode: (value: boolean) => void;
  isCustomMode: boolean;
  setSelectedPreset: (value: string) => void;
  setProviderParameters: Dispatch<
    SetStateAction<Record<string, Record<string, ParameterValue>>>
  >;
  handleCustomConfigUpdate: (updates: Partial<PublishConfigStore>) => void;
  pushRecentConfig: (key: string, repoId?: string | null) => void;
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
  buildProfileParameters: (config: DotnetCustomConfigDraft) => Record<string, unknown>;
}

export const QUICK_CREATE_CUSTOM_TEMPLATE_ID = "custom";
export const QUICK_CREATE_PROFILE_GROUP_DEFAULT = "__default__";
export const QUICK_CREATE_PROFILE_GROUP_CUSTOM = "__custom__";

const EMPTY_DOTNET_CUSTOM_CONFIG_DRAFT: DotnetCustomConfigDraft = {
  configuration: "Release",
  runtime: "",
  outputDir: "",
  selfContained: false,
};

const toDotnetCustomConfigDraftFromPreset = (
  preset: DotnetPreset
): DotnetCustomConfigDraft => ({
  configuration: preset.config.configuration,
  runtime: preset.config.runtime,
  outputDir: "",
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
  handleCustomConfigUpdate,
  pushRecentConfig,
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
    useState<DotnetCustomConfigDraft>(EMPTY_DOTNET_CUSTOM_CONFIG_DRAFT);
  const [quickCreateProfileGroup, setQuickCreateProfileGroup] = useState(
    QUICK_CREATE_PROFILE_GROUP_DEFAULT
  );
  const [quickCreateProfileCustomGroup, setQuickCreateProfileCustomGroup] =
    useState("");
  const [quickCreateProfileSaving, setQuickCreateProfileSaving] = useState(false);
  const [editingProfileOriginalName, setEditingProfileOriginalName] = useState<string | null>(null);

  const loadProfiles = useCallback(async () => {
    if (!selectedRepoId) {
      setProfiles([]);
      return;
    }

    try {
      const data = await getProfiles(selectedRepoId);
      setProfiles(data);
    } catch (err) {
      console.error("加载配置文件列表失败:", err);
    }
  }, [selectedRepoId]);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  const resetQuickCreateProfileState = useCallback(() => {
    setQuickCreateProfileName("");
    setQuickCreateTemplateId(QUICK_CREATE_CUSTOM_TEMPLATE_ID);
    setQuickCreateProfileDraft(EMPTY_DOTNET_CUSTOM_CONFIG_DRAFT);
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
    setQuickCreateProfileDraft({
      configuration:
        typeof parameters.configuration === "string"
          ? parameters.configuration
          : "Release",
      runtime: typeof parameters.runtime === "string" ? parameters.runtime : "",
      outputDir: typeof parameters.output === "string" ? parameters.output : "",
      selfContained: parameters.self_contained === true,
    });
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
      setQuickCreateProfileDraft(EMPTY_DOTNET_CUSTOM_CONFIG_DRAFT);
      return;
    }

    const matchedPreset = presets.find((preset) => preset.id === templateId);
    if (!matchedPreset) {
      setQuickCreateTemplateId(QUICK_CREATE_CUSTOM_TEMPLATE_ID);
      setQuickCreateProfileDraft(EMPTY_DOTNET_CUSTOM_CONFIG_DRAFT);
      return;
    }

    setQuickCreateProfileDraft(toDotnetCustomConfigDraftFromPreset(matchedPreset));
  }, [presets]);

  const updateQuickCreateProfileDraft = useCallback(
    (updates: Partial<DotnetCustomConfigDraft>) => {
      setQuickCreateTemplateId(QUICK_CREATE_CUSTOM_TEMPLATE_ID);
      setQuickCreateProfileDraft((prev) => ({ ...prev, ...updates }));
    },
    []
  );

  const applyProfile = useCallback(
    async (profile: LoadableProfile) => {
      const { applyProfileRuntime } = await loadProfilesRuntime();
      await applyProfileRuntime({
        profile,
        activeProviderId,
        providerSchemas,
        setActiveProviderId,
        setIsCustomMode,
        setProviderParameters,
        handleCustomConfigUpdate,
        appT,
      });
    },
    [
      activeProviderId,
      appT,
      handleCustomConfigUpdate,
      providerSchemas,
      setActiveProviderId,
      setIsCustomMode,
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
    async (profile: ConfigProfile) => {
      setActiveProfileName(profile.name);
      await applyProfile(profile);
    },
    [applyProfile]
  );

  const handleQuickCreateProfileSave = useCallback(async () => {
    const { handleQuickCreateProfileSaveRuntime } = await loadProfilesRuntime();
    await handleQuickCreateProfileSaveRuntime({
      selectedRepoId,
      quickCreateProfileName,
      quickCreateProfileGroup,
      quickCreateProfileCustomGroup,
      quickCreateProfileSaving,
      quickCreateProfileDraft,
      editingProfileOriginalName,
      buildProfileParameters,
      loadProfiles,
      handleSelectProfileFromPanel,
      replaceScopedConfigKey,
      pushRecentConfig,
      profileT,
      handleQuickCreateProfileOpenChange,
      setQuickCreateProfileSaving,
    });
  }, [
    buildProfileParameters,
    editingProfileOriginalName,
    handleQuickCreateProfileOpenChange,
    handleSelectProfileFromPanel,
    loadProfiles,
    profileT,
    pushRecentConfig,
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
      const { handleDeleteProfileFromPanelRuntime } =
        await loadProfilesRuntime();
      await handleDeleteProfileFromPanelRuntime({
        selectedRepoId,
        name,
        loadProfiles,
        activeProfileName,
        setActiveProfileName,
        isCustomMode,
        setIsCustomMode,
        setSelectedPreset,
        defaultPresetId,
      });
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
    async (profile: LoadableProfile) => {
      await applyProfile(profile);
    },
    [applyProfile]
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
  };
}
