import { toast } from "sonner";

import { mapImportedSpecByProvider } from "@/lib/commandImportMapping";
import {
  deleteProfile,
  saveProfile,
  updateProfile,
  type ConfigProfile,
  type PublishConfigStore,
} from "@/lib/store";
import { extractInvokeErrorMessage } from "@/lib/tauri/invokeErrors";
import type { Dispatch, SetStateAction } from "react";
import type { ParameterSchema, ParameterValue } from "@/types/parameters";

interface TranslationMap {
  [key: string]: string | undefined;
}

interface DotnetCustomConfigDraft {
  configuration: string;
  runtime: string;
  outputDir: string;
  selfContained: boolean;
}

interface LoadableProfile {
  name: string;
  providerId?: string;
  provider_id?: string;
  parameters?: Record<string, unknown>;
}

export async function applyProfileRuntime(params: {
  profile: LoadableProfile;
  activeProviderId: string;
  providerSchemas: Record<string, ParameterSchema>;
  setActiveProviderId: (value: string) => void;
  setIsCustomMode: (value: boolean) => void;
  setProviderParameters: Dispatch<
    SetStateAction<Record<string, Record<string, ParameterValue>>>
  >;
  handleCustomConfigUpdate: (updates: Partial<PublishConfigStore>) => void;
  appT: TranslationMap;
}) {
  const {
    profile,
    activeProviderId,
    providerSchemas,
    setActiveProviderId,
    setIsCustomMode,
    setProviderParameters,
    handleCustomConfigUpdate,
    appT,
  } = params;
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
}

export async function handleQuickCreateProfileSaveRuntime(params: {
  selectedRepoId: string | null;
  quickCreateProfileName: string;
  quickCreateProfileGroup: string;
  quickCreateProfileCustomGroup: string;
  quickCreateProfileSaving: boolean;
  quickCreateProfileDraft: DotnetCustomConfigDraft;
  editingProfileOriginalName: string | null;
  buildProfileParameters: (config: DotnetCustomConfigDraft) => Record<string, unknown>;
  loadProfiles: () => Promise<void>;
  handleSelectProfileFromPanel: (profile: ConfigProfile) => void | Promise<void>;
  replaceScopedConfigKey: (
    previousKey: string,
    nextKey: string,
    repoId?: string | null
  ) => void;
  pushRecentConfig: (key: string, repoId?: string | null) => void;
  profileT: TranslationMap;
  handleQuickCreateProfileOpenChange: (open: boolean) => void;
  setQuickCreateProfileSaving: (value: boolean) => void;
}) {
  const {
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
  } = params;

  if (!selectedRepoId) {
    return;
  }

  const profileName = quickCreateProfileName.trim();
  if (!profileName) {
    toast.error(profileT.enterProfileName || "请输入配置文件名称");
    return;
  }

  const resolvedProfileGroup =
    quickCreateProfileGroup === "__default__"
      ? ""
      : quickCreateProfileGroup === "__custom__"
        ? quickCreateProfileCustomGroup.trim()
        : quickCreateProfileGroup.trim();

  if (quickCreateProfileGroup === "__custom__" && !resolvedProfileGroup) {
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

    await handleSelectProfileFromPanel({
      name: profileName,
      providerId: "dotnet",
      parameters,
      profileGroup: resolvedProfileGroup || undefined,
      createdAt: new Date().toISOString(),
      isSystemDefault: false,
    });
    if (editingProfileOriginalName && editingProfileOriginalName !== profileName) {
      replaceScopedConfigKey(
        `userprofile:${editingProfileOriginalName}`,
        nextProfileKey,
        selectedRepoId
      );
    } else {
      pushRecentConfig(nextProfileKey);
    }

    toast.success(
      isEditing
        ? profileT.quickEditSuccess || "配置文件更新成功"
        : profileT.saveSuccess || "配置文件保存成功"
    );
    handleQuickCreateProfileOpenChange(false);
  } catch (err) {
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
}

export async function handleDeleteProfileFromPanelRuntime(params: {
  selectedRepoId: string | null;
  name: string;
  loadProfiles: () => Promise<void>;
  activeProfileName: string | null;
  setActiveProfileName: (value: string | null) => void;
  isCustomMode: boolean;
  setIsCustomMode: (value: boolean) => void;
  setSelectedPreset: (value: string) => void;
  defaultPresetId: string;
}) {
  const {
    selectedRepoId,
    name,
    loadProfiles,
    activeProfileName,
    setActiveProfileName,
    isCustomMode,
    setIsCustomMode,
    setSelectedPreset,
    defaultPresetId,
  } = params;

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
}
