import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { toast } from "sonner";

import { mapImportedSpecByProvider } from "@/lib/commandImportMapping";
import { extractInvokeErrorMessage } from "@/lib/tauri/invokeErrors";
import {
  deleteProfile,
  getProfiles,
  saveProfile,
  type ConfigProfile,
  type PublishConfigStore,
} from "@/lib/store";
import type { Language } from "@/hooks/useI18n";
import type { ParameterSchema, ParameterValue } from "@/types/parameters";

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

  const openQuickCreateProfileDialog = useCallback(() => {
    setQuickCreateProfileName("");
    setQuickCreateTemplateId(QUICK_CREATE_CUSTOM_TEMPLATE_ID);
    setQuickCreateProfileDraft(EMPTY_DOTNET_CUSTOM_CONFIG_DRAFT);
    setQuickCreateProfileGroup(QUICK_CREATE_PROFILE_GROUP_DEFAULT);
    setQuickCreateProfileCustomGroup("");
    setQuickCreateProfileOpen(true);
  }, []);

  const handleQuickCreateProfileOpenChange = useCallback((open: boolean) => {
    setQuickCreateProfileOpen(open);
    if (!open) {
      setQuickCreateProfileName("");
      setQuickCreateTemplateId(QUICK_CREATE_CUSTOM_TEMPLATE_ID);
      setQuickCreateProfileGroup(QUICK_CREATE_PROFILE_GROUP_DEFAULT);
      setQuickCreateProfileCustomGroup("");
      setQuickCreateProfileSaving(false);
    }
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
        handleCustomConfigUpdate(mapping.dotnetUpdates);
        setIsCustomMode(true);
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
      await saveProfile({
        repoId: selectedRepoId,
        name: profileName,
        providerId: "dotnet",
        parameters,
        profileGroup: resolvedProfileGroup || undefined,
      });

      await loadProfiles();

      handleSelectProfileFromPanel({
        name: profileName,
        providerId: "dotnet",
        parameters,
        profileGroup: resolvedProfileGroup || undefined,
        createdAt: new Date().toISOString(),
        isSystemDefault: false,
      });
      pushRecentConfig(`userprofile:${profileName}`);

      toast.success(profileT.saveSuccess || "配置文件保存成功");
      handleQuickCreateProfileOpenChange(false);
    } catch (err) {
      console.error("保存配置文件失败:", err);
      toast.error(
        extractInvokeErrorMessage(err) || profileT.saveFailed || "保存配置文件失败"
      );
    } finally {
      setQuickCreateProfileSaving(false);
    }
  }, [
    buildProfileParameters,
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
    loadProfiles,
    setActiveProfileName,
    openQuickCreateProfileDialog,
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
