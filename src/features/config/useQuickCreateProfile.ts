import { useCallback, useMemo, useState } from "react";

import { toast } from "sonner";
import { createDefaultDotnetPublishConfig } from "@/features/config/dotnetPublishConfig";
import type {
  ConfigParameters,
  ConfigProfile,
  PublishConfigStore,
} from "@/lib/store/types";
import { toSpecValue, type ParameterValue } from "@/types/parameters";
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

/** Quick create/edit 表单草稿：所有 Provider 统一以 schema 参数记录为
 * 草稿（参数即事实，无转换层）。 */
export interface QuickCreateProfileDraft {
  providerId: string;
  parameters: ConfigParameters;
}

const createDraftForProvider = (
  providerId: string,
  parameters: ConfigParameters = {}
): QuickCreateProfileDraft => ({ providerId, parameters });

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
  activeProviderId: string;
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
    profileId: string;
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
  quickCreateProfileDraft: QuickCreateProfileDraft;
  quickCreateProfileGroup: string;
  setQuickCreateProfileGroup: (value: string) => void;
  quickCreateProfileCustomGroup: string;
  setQuickCreateProfileCustomGroup: (value: string) => void;
  quickCreateProfileSaving: boolean;
  isQuickCreateEditing: boolean;
  isQuickCreateViewing: boolean;
  openQuickCreateProfileDialog: () => void;
  openQuickEditProfileDialog: (profile: ConfigProfile) => void;
  openQuickViewProfileDialog: (profile: ConfigProfile) => void;
  handleQuickCreateProfileOpenChange: (open: boolean) => void;
  quickCreateTemplateOptions: QuickCreateTemplateOption[];
  quickCreateProfileGroupOptions: string[];
  applyQuickCreateTemplate: (templateId: string) => void;
  updateQuickCreateProfileParameter: (
    key: string,
    value: ParameterValue
  ) => void;
  handleQuickCreateProfileSave: () => Promise<void>;
}

export function useQuickCreateProfile({
  selectedRepoId,
  activeProviderId,
  profileT,
  presets,
  profiles,
  language,
  getPresetText,
  buildProfileParameters,
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
    useState<QuickCreateProfileDraft>(() => createDraftForProvider("dotnet"));
  const [quickCreateProfileGroup, setQuickCreateProfileGroup] = useState(
    QUICK_CREATE_PROFILE_GROUP_DEFAULT
  );
  const [quickCreateProfileCustomGroup, setQuickCreateProfileCustomGroup] =
    useState("");
  const [quickCreateProfileSaving, setQuickCreateProfileSaving] =
    useState(false);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [quickCreateViewing, setQuickCreateViewing] = useState(false);

  const resetQuickCreateProfileState = useCallback(() => {
    setQuickCreateProfileName("");
    setQuickCreateTemplateId(QUICK_CREATE_CUSTOM_TEMPLATE_ID);
    setQuickCreateProfileDraft(createDraftForProvider(activeProviderId));
    setQuickCreateProfileGroup(QUICK_CREATE_PROFILE_GROUP_DEFAULT);
    setQuickCreateProfileCustomGroup("");
    setQuickCreateProfileSaving(false);
    setEditingProfileId(null);
    setQuickCreateViewing(false);
  }, [activeProviderId]);

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

  const loadProfileIntoDialog = useCallback(
    (profile: ConfigProfile, viewing: boolean) => {
      const parameters = profile.parameters || {};
      const resolvedGroup = profile.profileGroup?.trim() || "";

      setQuickCreateProfileName(profile.name);
      setQuickCreateTemplateId(QUICK_CREATE_CUSTOM_TEMPLATE_ID);
      setQuickCreateProfileDraft(
        createDraftForProvider(profile.providerId, parameters)
      );
      setQuickCreateProfileGroup(
        resolvedGroup || QUICK_CREATE_PROFILE_GROUP_DEFAULT
      );
      setQuickCreateProfileCustomGroup("");
      setQuickCreateProfileSaving(false);
      setEditingProfileId(profile.id);
      setQuickCreateViewing(viewing);
      setQuickCreateProfileOpen(true);
    },
    []
  );

  const openQuickEditProfileDialog = useCallback(
    (profile: ConfigProfile) => {
      if (profile.isSystemDefault) {
        return;
      }
      loadProfileIntoDialog(profile, false);
    },
    [loadProfileIntoDialog]
  );

  const openQuickViewProfileDialog = useCallback(
    (profile: ConfigProfile) => {
      loadProfileIntoDialog(profile, true);
    },
    [loadProfileIntoDialog]
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

      const presetDraft = (config: PublishConfigStore) =>
        createDraftForProvider("dotnet", buildProfileParameters(config));

      if (templateId === QUICK_CREATE_CUSTOM_TEMPLATE_ID) {
        setQuickCreateProfileDraft(createDraftForProvider("dotnet"));
        return;
      }

      const matchedPreset = presets.find((preset) => preset.id === templateId);
      if (!matchedPreset) {
        setQuickCreateTemplateId(QUICK_CREATE_CUSTOM_TEMPLATE_ID);
        setQuickCreateProfileDraft(createDraftForProvider("dotnet"));
        return;
      }

      setQuickCreateProfileDraft(
        presetDraft(toDotnetCustomConfigDraftFromPreset(matchedPreset))
      );
    },
    [buildProfileParameters, presets]
  );

  const updateQuickCreateProfileParameter = useCallback(
    (key: string, value: ParameterValue) => {
      setQuickCreateTemplateId(QUICK_CREATE_CUSTOM_TEMPLATE_ID);
      setQuickCreateProfileDraft((prev) => ({
        ...prev,
        parameters: { ...prev.parameters, [key]: toSpecValue(value) },
      }));
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
      const { providerId, parameters } = quickCreateProfileDraft;
      const isEditing = Boolean(editingProfileId);

      let mutationState;
      if (editingProfileId) {
        mutationState = await updateProfile({
          repoId: selectedRepoId,
          profileId: editingProfileId,
          name: profileName,
          providerId,
          parameters,
          profileGroup: resolvedProfileGroup || undefined,
        });
      } else {
        mutationState = await saveProfileToStore({
          repoId: selectedRepoId,
          name: profileName,
          providerId,
          parameters,
          profileGroup: resolvedProfileGroup || undefined,
        });
      }

      const mutationRepo = mutationState.repositories.find(
        (r) => r.id === selectedRepoId
      );
      const nextProfiles = mutationRepo
        ? await refreshProfilesAfterMutation(
            selectedRepoId,
            mutationRepo.publishConfig.profiles
          )
        : await refreshProfilesAfterMutation(selectedRepoId);
      const savedProfile = editingProfileId
        ? nextProfiles.find((profile) => profile.id === editingProfileId)
        : nextProfiles.find((profile) => profile.name === profileName);
      if (!savedProfile?.id) {
        throw new Error("保存后未找到配置身份");
      }
      onProfileSaved(savedProfile);

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
          (editingProfileId
            ? profileT.quickEditFailed || "更新配置文件失败"
            : profileT.saveFailed || "保存配置文件失败")
      );
    } finally {
      setQuickCreateProfileSaving(false);
    }
  }, [
    editingProfileId,
    handleQuickCreateProfileOpenChange,
    onProfileSaved,
    profileT,
    quickCreateProfileCustomGroup,
    quickCreateProfileDraft,
    quickCreateProfileGroup,
    quickCreateProfileName,
    quickCreateProfileSaving,
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
    isQuickCreateEditing: editingProfileId !== null,
    isQuickCreateViewing: quickCreateViewing,
    openQuickCreateProfileDialog,
    openQuickEditProfileDialog,
    openQuickViewProfileDialog,
    handleQuickCreateProfileOpenChange,
    quickCreateTemplateOptions,
    quickCreateProfileGroupOptions,
    applyQuickCreateTemplate,
    updateQuickCreateProfileParameter,
    handleQuickCreateProfileSave,
  };
}
