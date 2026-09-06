import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { toast } from "sonner";
import { resolvePublishSource } from "@/features/publish/publishRuntime";
import type { ConfigParameters, ConfigProfile } from "@/lib/store/types";
import { toSpecValue, type ParameterValue } from "@/types/parameters";
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

interface QuickCreateBackendTemplate {
  id: string;
  name: string;
  description: string;
}

export interface UseQuickCreateProfileParams {
  backendTemplates: QuickCreateBackendTemplate[];
  projectBinding?: string | null;
  selectedRepoId: string | null;
  activeProviderId: string;
  profileT: TranslationMap;
  profiles: ConfigProfile[];
  language: Language;
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
  openQuickCreateProfileDialog: (draft?: QuickCreateProfileDraft) => void;
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
  profiles,
  language,
  backendTemplates,
  projectBinding = null,
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
    useState<QuickCreateProfileDraft>(() =>
      createDraftForProvider(activeProviderId)
    );
  const [quickCreateProfileGroup, setQuickCreateProfileGroup] = useState(
    QUICK_CREATE_PROFILE_GROUP_DEFAULT
  );
  const [quickCreateProfileCustomGroup, setQuickCreateProfileCustomGroup] =
    useState("");
  const [quickCreateProfileSaving, setQuickCreateProfileSaving] =
    useState(false);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [quickCreateViewing, setQuickCreateViewing] = useState(false);

  const templateRequestRef = useRef(0);
  const templateLoadingRef = useRef(false);
  const [templateLoading, setTemplateLoading] = useState(false);
  const invalidateTemplateRequest = useCallback(() => {
    templateRequestRef.current += 1;
    templateLoadingRef.current = false;
    setTemplateLoading(false);
  }, []);

  useEffect(() => {
    return () => {
      templateRequestRef.current += 1;
      templateLoadingRef.current = false;
    };
  }, [selectedRepoId, activeProviderId, projectBinding]);

  useEffect(() => {
    setTemplateLoading(false);
    setQuickCreateProfileOpen(false);
  }, [selectedRepoId, activeProviderId, projectBinding]);

  const resetQuickCreateProfileState = useCallback(() => {
    invalidateTemplateRequest();
    setQuickCreateProfileName("");
    setQuickCreateTemplateId(QUICK_CREATE_CUSTOM_TEMPLATE_ID);
    setQuickCreateProfileDraft(createDraftForProvider(activeProviderId));
    setQuickCreateProfileGroup(QUICK_CREATE_PROFILE_GROUP_DEFAULT);
    setQuickCreateProfileCustomGroup("");
    setQuickCreateProfileSaving(false);
    setEditingProfileId(null);
    setQuickCreateViewing(false);
  }, [activeProviderId, invalidateTemplateRequest]);

  const openQuickCreateProfileDialog = useCallback(
    (draft?: QuickCreateProfileDraft) => {
      resetQuickCreateProfileState();
      if (draft) setQuickCreateProfileDraft(draft);
      setQuickCreateProfileOpen(true);
    },
    [resetQuickCreateProfileState]
  );

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
      invalidateTemplateRequest();
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
    [invalidateTemplateRequest]
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
      ...backendTemplates.map((template) => ({
        id: template.id,
        name: template.name,
        description: template.description,
      })),
    ],
    [backendTemplates, profileT.quickCreateTemplateCustom]
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
    async (templateId: string) => {
      invalidateTemplateRequest();
      setQuickCreateTemplateId(templateId);
      const providerId = quickCreateProfileDraft.providerId;
      if (templateId === QUICK_CREATE_CUSTOM_TEMPLATE_ID) {
        setQuickCreateProfileDraft(createDraftForProvider(providerId));
        return;
      }
      if (!selectedRepoId || !quickCreateProfileOpen) return;

      const request = templateRequestRef.current;
      templateLoadingRef.current = true;
      setTemplateLoading(true);
      try {
        const resolved = await resolvePublishSource(selectedRepoId, {
          kind: "template",
          providerId,
          templateId,
          projectBinding,
        });
        if (request !== templateRequestRef.current) return;
        if (resolved.blockedReason || resolved.diagnostics.length > 0) {
          throw new Error(
            resolved.blockedReason ||
              resolved.diagnostics.map((item) => item.message).join("\n")
          );
        }
        const { content } = resolved.draft;
        if (
          !content.parameters ||
          typeof content.parameters !== "object" ||
          Array.isArray(content.parameters)
        ) {
          throw new Error("模板参数必须是对象");
        }
        setQuickCreateProfileDraft(
          createDraftForProvider(content.providerId, content.parameters)
        );
      } catch (error) {
        const { extractInvokeErrorMessage } = await loadInvokeErrors();
        if (request !== templateRequestRef.current) return;
        setQuickCreateTemplateId(QUICK_CREATE_CUSTOM_TEMPLATE_ID);
        toast.error(extractInvokeErrorMessage(error) || "加载模板失败");
      } finally {
        if (request === templateRequestRef.current) {
          templateLoadingRef.current = false;
          setTemplateLoading(false);
        }
      }
    },
    [
      invalidateTemplateRequest,
      projectBinding,
      quickCreateProfileDraft.providerId,
      quickCreateProfileOpen,
      selectedRepoId,
    ]
  );

  const updateQuickCreateProfileParameter = useCallback(
    (key: string, value: ParameterValue) => {
      invalidateTemplateRequest();
      setQuickCreateTemplateId(QUICK_CREATE_CUSTOM_TEMPLATE_ID);
      setQuickCreateProfileDraft((prev) => ({
        ...prev,
        parameters: { ...prev.parameters, [key]: toSpecValue(value) },
      }));
    },
    [invalidateTemplateRequest]
  );

  const handleQuickCreateProfileSave = useCallback(async () => {
    if (!selectedRepoId || templateLoadingRef.current) {
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
    quickCreateProfileSaving: quickCreateProfileSaving || templateLoading,
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
