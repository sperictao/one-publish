import { useCallback, useMemo, useState } from "react";

import { toast } from "sonner";
import { createUserProfileConfigKey } from "@/features/config/publishConfigIdentity";
import {
  createDefaultDotnetPublishConfig,
  createDotnetPublishConfigFromParameters,
} from "@/features/config/dotnetPublishConfig";
import type {
  ConfigParameters,
  ConfigProfile,
  PublishConfigStore,
} from "@/lib/store/types";
import type { DotnetPreset } from "@/features/config/dotnetPresets";
import type { Language } from "@/hooks/useI18n";
import type { TranslationMap, QuickCreateTemplateOption } from "./types";
import {
  QUICK_CREATE_CUSTOM_TEMPLATE_ID,
  QUICK_CREATE_PROFILE_GROUP_DEFAULT,
  QUICK_CREATE_PROFILE_GROUP_CUSTOM,
} from "./types";

const loadInvokeErrors = () => import("@/lib/tauri/invokeErrors");

interface StoreMutationResult {
  repositories: Array<{
    id: string;
    publishConfig: { profiles: ConfigProfile[] };
  }>;
}

const toDotnetCustomConfigDraftFromPreset = (
  preset: DotnetPreset
): PublishConfigStore => ({
  ...createDefaultDotnetPublishConfig(),
  configuration: preset.config.configuration,
  runtime: preset.config.runtime,
  selfContained: preset.config.self_contained,
});

export interface UseQuickCreateProfileParams {
  selectedRepoId: string | null;
  profileT: TranslationMap;
  presets: DotnetPreset[];
  profiles: ConfigProfile[];
  language: Language;
  getPresetText: (
    presetId: string,
    fallbackName: string,
    fallbackDescription: string
  ) => {
    name: string;
    description: string;
  };
  buildProfileParameters: (config: PublishConfigStore) => ConfigParameters;
  replaceScopedConfigKey: (
    previousKey: string,
    nextKey: string,
    repoId?: string | null
  ) => void;
  refreshProfilesAfterMutation: (
    repoId: string,
    preFetchedProfiles?: ConfigProfile[]
  ) => Promise<ConfigProfile[]>;
  saveProfileToStore: (params: {
    repoId: string;
    name: string;
    providerId: string;
    parameters: ConfigParameters;
    profileGroup?: string;
  }) => Promise<StoreMutationResult>;
  updateProfile: (params: {
    repoId: string;
    originalName: string;
    name: string;
    providerId: string;
    parameters: ConfigParameters;
    profileGroup?: string;
  }) => Promise<StoreMutationResult>;
  /** Called after a profile is saved/edited successfully, with the resulting profile. */
  onProfileSaved: (profile: ConfigProfile) => void;
}

export interface UseQuickCreateProfileReturn {
  quickCreateProfileOpen: boolean;
  quickCreateProfileName: string;
  setQuickCreateProfileName: (value: string) => void;
  quickCreateTemplateId: string;
  quickCreateProfileDraft: PublishConfigStore;
  quickCreateProfileGroup: string;
  setQuickCreateProfileGroup: (value: string) => void;
  quickCreateProfileCustomGroup: string;
  setQuickCreateProfileCustomGroup: (value: string) => void;
  quickCreateProfileSaving: boolean;
  isQuickCreateEditing: boolean;
  openQuickCreateProfileDialog: () => void;
  openQuickEditProfileDialog: (profile: ConfigProfile) => void;
  handleQuickCreateProfileOpenChange: (open: boolean) => void;
  quickCreateTemplateOptions: QuickCreateTemplateOption[];
  quickCreateProfileGroupOptions: string[];
  applyQuickCreateTemplate: (templateId: string) => void;
  updateQuickCreateProfileDraft: (updates: Partial<PublishConfigStore>) => void;
  handleQuickCreateProfileSave: () => Promise<void>;
}

export function useQuickCreateProfile({
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
  onProfileSaved,
}: UseQuickCreateProfileParams): UseQuickCreateProfileReturn {
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
  const [editingProfileOriginalName, setEditingProfileOriginalName] = useState<
    string | null
  >(null);

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

  const handleQuickCreateProfileOpenChange = useCallback(
    (open: boolean) => {
      setQuickCreateProfileOpen(open);
      if (!open) {
        resetQuickCreateProfileState();
      }
    },
    [resetQuickCreateProfileState]
  );

  const openQuickEditProfileDialog = useCallback(
    (profile: ConfigProfile) => {
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
    },
    []
  );

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
    const groupSet = new Set<string>();
    for (const profile of profiles) {
      const group = profile.profileGroup?.trim() || "";
      if (
        group.length > 0 &&
        group !== QUICK_CREATE_PROFILE_GROUP_DEFAULT &&
        group !== QUICK_CREATE_PROFILE_GROUP_CUSTOM
      ) {
        groupSet.add(group);
      }
    }

    return Array.from(groupSet).sort((left, right) =>
      left.localeCompare(right, language === "en" ? "en" : "zh-CN")
    );
  }, [profiles, language]);

  const applyQuickCreateTemplate = useCallback(
    (templateId: string) => {
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

      setQuickCreateProfileDraft(
        toDotnetCustomConfigDraftFromPreset(matchedPreset)
      );
    },
    [presets]
  );

  const updateQuickCreateProfileDraft = useCallback(
    (updates: Partial<PublishConfigStore>) => {
      setQuickCreateTemplateId(QUICK_CREATE_CUSTOM_TEMPLATE_ID);
      setQuickCreateProfileDraft((prev) => ({ ...prev, ...updates }));
    },
    []
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

      let mutationState;
      if (editingProfileOriginalName) {
        mutationState = await updateProfile({
          repoId: selectedRepoId,
          originalName: editingProfileOriginalName,
          name: profileName,
          providerId: "dotnet",
          parameters,
          profileGroup: resolvedProfileGroup || undefined,
        });
      } else {
        mutationState = await saveProfileToStore({
          repoId: selectedRepoId,
          name: profileName,
          providerId: "dotnet",
          parameters,
          profileGroup: resolvedProfileGroup || undefined,
        });
      }

      const mutationRepo = mutationState.repositories.find(
        (r) => r.id === selectedRepoId
      );
      if (mutationRepo) {
        await refreshProfilesAfterMutation(
          selectedRepoId,
          mutationRepo.publishConfig.profiles
        );
      }

      onProfileSaved({
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
    onProfileSaved,
    profileT,
    quickCreateProfileCustomGroup,
    quickCreateProfileDraft,
    quickCreateProfileGroup,
    quickCreateProfileName,
    quickCreateProfileSaving,
    replaceScopedConfigKey,
    refreshProfilesAfterMutation,
    saveProfileToStore,
    selectedRepoId,
    updateProfile,
  ]);

  return {
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
    openQuickCreateProfileDialog,
    openQuickEditProfileDialog,
    handleQuickCreateProfileOpenChange,
    quickCreateTemplateOptions,
    quickCreateProfileGroupOptions,
    applyQuickCreateTemplate,
    updateQuickCreateProfileDraft,
    handleQuickCreateProfileSave,
  };
}
