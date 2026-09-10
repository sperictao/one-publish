import { useCallback, useMemo } from "react";
import type { ArtifactActionState } from "@/lib/artifact";
import { usePublishStore } from "@/stores/publishStore";
import { usePublishRunner } from "@/features/publish/usePublishRunner";
import {
  useProfiles,
  QUICK_CREATE_PROFILE_GROUP_CUSTOM,
  QUICK_CREATE_PROFILE_GROUP_DEFAULT,
} from "@/features/config/useProfiles";
import { useCommandImport } from "@/hooks/useCommandImport";
import { useScopedConfigs } from "@/features/config/useScopedConfigs";
import { useProviderPresentationState } from "@/features/provider/useProviderPresentationState";
import { usePublishConfigPanelProps } from "@/hooks/usePublishConfigPanelProps";
import { usePublishRunCardProps } from "@/hooks/usePublishRunCardProps";
import type {
  PublishComposition,
  PublishEditStateUpdate,
} from "@/generated/tauri-contracts";
import {
  rebindProfileProject,
  updateProfile as updateProfileInStore,
} from "@/lib/store/api";
import type { EnvironmentCheckSnapshot } from "@/features/environment/environment";
import type { CommandImportResultCardProps } from "@/components/publish/CommandImportResultCard";
import type { ProviderPublishSpec } from "@/features/publish/publishRuntime";
import type { ParameterValue, ParameterSchema } from "@/types/parameters";
import type { ResourceState } from "@/features/provider/useProviderRuntime";
import type {
  ConfigProfile,
  ProviderManifest,
  Repository,
  ProjectInfo,
  ExecutionRecord,
} from "@/lib/store/types";

const SPEC_VERSION = 1;
const EMPTY_STRING_LIST: string[] = [];

type RightPanelView = "home" | "history";

interface TranslationMap {
  [key: string]: string | undefined;
}

interface UsePublishBootParams {
  // From useAppState (publish domain)
  updatePublishEditState: (update: PublishEditStateUpdate) => void;
  recentConfigKeysByRepo: Record<string, string[]>;
  pushRecentPublishConfig: (key: string, repoId?: string | null) => void;
  removeRecentPublishConfig: (key: string, repoId?: string | null) => void;
  reorderRecentPublishConfigs: (keys: string[], repoId?: string | null) => void;
  replaceRecentPublishConfigKey: (
    previousKey: string,
    nextKey: string,
    repoId?: string | null
  ) => void;
  defaultOutputDir: string;
  executionHistoryLimit: number;

  // From shell domain (translations + dialogs)
  configT: TranslationMap;
  publishT: TranslationMap;
  appT: TranslationMap;
  historyT: TranslationMap;
  failureT: TranslationMap;
  profileT: TranslationMap;
  language: "zh" | "en";
  openEnvironmentDialog: (
    initialCheck?: EnvironmentCheckSnapshot | null,
    providerIds?: string[]
  ) => void;
  leftPanelCollapsed: boolean;
  setLeftPanelCollapsed: (collapsed: boolean) => void;
  middlePanelCollapsed: boolean;
  setMiddlePanelCollapsed: (collapsed: boolean) => void;
  rightPanelView: RightPanelView;
  handleConfigDialogOpenChange: (open: boolean, onClose?: () => void) => void;

  // From repo domain
  selectedRepoId: string | null;
  selectedRepo: Repository | null;
  projectInfo: ProjectInfo | null;
  isProjectInfoRefreshing: boolean;
  scanProject: (
    path?: string,
    options?: { projectFile?: string }
  ) => Promise<ProjectInfo | null>;
  orderedProjectPublishProfiles: string[];
  reorderProjectPublishProfiles: (orderedNames: string[]) => void;
  extractSpecFromRecord: (
    record: ExecutionRecord
  ) => ProviderPublishSpec | null;
  setEnvironmentLastCheck: (snapshot: EnvironmentCheckSnapshot | null) => void;
  recentHistoryExports: string[];
  trackHistoryExport: (outputPath: string) => void;

  // Lifted provider state
  activeProviderId: string;
  setActiveProviderId: React.Dispatch<React.SetStateAction<string>>;
  providerListState: ResourceState<ProviderManifest[]>;
  activeProviderSchemaState: ResourceState<ParameterSchema>;
  retryProviderList: () => void;
  retryProviderSchema: (providerId?: string) => void;
  providerSchemas: Record<string, ParameterSchema>;
  providerRuntimeProviders: ProviderManifest[];
  activeProvider: ProviderManifest | null;
  activeProviderParameters: Record<string, ParameterValue>;
  setProviderParameters: React.Dispatch<
    React.SetStateAction<Record<string, Record<string, ParameterValue>>>
  >;
  applyProfileProvider: (providerId: string) => void;
  applySelectedRepositoryProvider: (providerId?: string | null) => void;

  // Lifted publish history state
  executionHistory: ExecutionRecord[];
  savePublishRecord: (record: ExecutionRecord) => Promise<void>;

  // Lifted publish store state
  isPublishing: boolean;
  isCancellingPublish: boolean;
  publishResult: any;
  releaseChecklistOpen: boolean;
  setReleaseChecklistOpen: (open: boolean) => void;
  artifactActionState: ArtifactActionState;
  setArtifactActionState: (state: ArtifactActionState) => void;
}

export function usePublishBoot(params: UsePublishBootParams) {
  // Provider presentation
  const {
    activeProviderLabel,
    activeProviderUsesProjectFile,
    activeProviderRequiresProjectBinding,
    repositoryProviders,
    providerRuntimeBanner,
  } = useProviderPresentationState({
    providerRuntimeProviders: params.providerRuntimeProviders,
    providerListState: params.providerListState,
    activeProviderSchemaState: params.activeProviderSchemaState,
    activeProvider: params.activeProvider,
    activeProviderId: params.activeProviderId,
    appT: params.appT,
    retryProviderList: params.retryProviderList,
    retryProviderSchema: params.retryProviderSchema,
  });

  // Scoped configs
  const {
    recentConfigKeys,
    favoriteConfigKeys,
    pushRecentConfig,
    removeRecentConfig,
    reorderRecentConfig,
    toggleFavoriteConfig,
    replaceScopedConfigKey,
  } = useScopedConfigs({
    selectedRepoId: params.selectedRepoId,
    recentConfigByRepo: params.recentConfigKeysByRepo,
    pushRecentConfig: params.pushRecentPublishConfig,
    removeRecentConfig: params.removeRecentPublishConfig,
    reorderRecentConfig: params.reorderRecentPublishConfigs,
  });

  // Preset text
  // Profiles
  const profilesState = useProfiles({
    backendTemplates: params.activeProvider?.templates ?? [],
    appT: params.appT,
    profileT: params.profileT,
    language: params.language,
    selectedRepoId: params.selectedRepoId,
    activeProviderId: params.activeProviderId,
    providerSchemas: params.providerSchemas,
    applyProfileProvider: params.applyProfileProvider,
    updatePublishEditState: params.updatePublishEditState,
    selectedRepo: params.selectedRepo,
    setProviderParameters: params.setProviderParameters,
    replaceScopedConfigKey,
  });

  const {
    profiles,
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
    isQuickCreateEditing,
    isQuickCreateViewing,
    loadProfiles,
    openQuickCreateProfileDialog,
    openQuickEditProfileDialog,
    openQuickViewProfileDialog,
    handleQuickCreateProfileOpenChange,
    quickCreateTemplateOptions,
    quickCreateProfileGroupOptions,
    applyQuickCreateTemplate,
    updateQuickCreateProfileParameter,
    handleSelectProjectProfile,
    handleSelectProfileFromPanel,
    handleQuickCreateProfileSave,
    handleDeleteProfileFromPanel,
    handleLoadProfile,
    handleCreateProfileFromProjectProfile,
    handleReorderProfiles,
    profileManagement,
  } = profilesState;
  const handleEditProfileFromPanel = useCallback(
    (profile: ConfigProfile) => {
      openQuickEditProfileDialog(profile);
    },
    [openQuickEditProfileDialog]
  );

  // 发布组合保存与显式换绑：一次保存产一版新修订，成功后刷新配置列表。
  const handleSaveProfileComposition = useCallback(
    async (profile: ConfigProfile, composition: PublishComposition) => {
      if (!params.selectedRepoId) {
        return;
      }
      await updateProfileInStore({
        repoId: params.selectedRepoId,
        profileId: profile.id,
        name: profile.name,
        providerId: profile.providerId,
        parameters: profile.parameters,
        profileGroup: profile.profileGroup ?? undefined,
        composition,
      });
      await loadProfiles();
    },
    [params.selectedRepoId, loadProfiles]
  );

  const handleRebindProfileProject = useCallback(
    async (profile: ConfigProfile) => {
      if (!params.selectedRepoId) {
        return;
      }
      await rebindProfileProject({
        repoId: params.selectedRepoId,
        profileId: profile.id,
      });
      await loadProfiles();
    },
    [params.selectedRepoId, loadProfiles]
  );

  const selectedConfiguration = useMemo(() => {
    const selection = params.selectedRepo?.publishConfig.selection;
    if (selection?.kind !== "revision") {
      return null;
    }
    return (
      profiles.find((profile) => profile.id === selection.configurationId) ??
      null
    );
  }, [params.selectedRepo, profiles]);

  // 编辑器水合（§4.1）：当前作用域（草稿/修订）的原始参数供配置对话框
  // 初值使用；所有 Provider 共用，只读——提交路径经 updatePublishEditState。
  const selectionParameters = useMemo<Record<
    string,
    ParameterValue
  > | null>(() => {
    const publishConfig = params.selectedRepo?.publishConfig;
    const selection = publishConfig?.selection;
    if (selection?.kind === "draft") {
      const draft = publishConfig?.drafts.find(
        (draft) =>
          draft.providerId === selection.providerId &&
          (draft.projectBinding ?? null) === (selection.projectBinding ?? null)
      );
      if (draft) {
        return (draft.content.parameters ?? {}) as Record<
          string,
          ParameterValue
        >;
      }
    }
    if (selection?.kind === "revision") {
      const profile = (publishConfig?.profiles ?? []).find(
        (profile) => profile.id === selection.configurationId
      );
      if (profile) {
        return (profile.parameters ?? {}) as Record<string, ParameterValue>;
      }
    }
    return null;
  }, [params.selectedRepo]);

  // Selection-derived key（列表高亮/最近使用身份）
  const selectionKey = useMemo(() => {
    const selection = params.selectedRepo?.publishConfig.selection;
    if (!selection) return "";
    switch (selection.kind) {
      case "revision":
        return `userprofile:${selection.configurationId}`;
      case "projectProfile":
        return `profile-${selection.reference}`;
      case "template":
        return selection.templateId;
      default:
        return "custom";
    }
  }, [params.selectedRepo]);

  // Publish runner
  const {
    outputLog,
    getOutputLogSnapshot,
    isResolvingSelectedProjectProfile,
    publishPreviewCommand,
    preparedRuntime,
    runtimePreparationError,
    activeRuntime,
    runtimeResult,
    runPublishSpec,
    startPublish,
    cancelPublish,
  } = usePublishRunner({
    appT: params.appT,
    publishT: params.publishT,
    selectedRepoId: params.selectedRepoId,
    selectedRepo: params.selectedRepo,
    activeProviderId: params.activeProviderId,
    activeProviderUsesProjectFile,
    activeProviderParameters: params.activeProviderParameters,
    selectionKey,
    defaultOutputDir: params.defaultOutputDir,
    projectInfo: params.projectInfo,
    specVersion: SPEC_VERSION,
    pushRecentConfig,
    openEnvironmentDialog: params.openEnvironmentDialog,
    setEnvironmentLastCheck: params.setEnvironmentLastCheck,
    savePublishRecord: params.savePublishRecord,
    configurationRevisionId: selectedConfiguration?.revisionId ?? null,
    currentConfigurationBlockedReason:
      selectedConfiguration?.blockedReason ?? null,
  });

  const { activeImportFeedback, handleCommandImport } = useCommandImport({
    activeProviderId: params.activeProviderId,
    appT: params.appT,
    onImportDraft: (result) =>
      openQuickCreateProfileDialog({
        providerId: result.providerId,
        parameters: result.parameters,
      }),
  });

  // Derived values
  const projectFrameworkOptions =
    params.projectInfo?.target_frameworks ?? EMPTY_STRING_LIST;
  const isProjectProfilesRefreshing =
    Boolean(params.selectedRepo) &&
    activeProviderUsesProjectFile &&
    params.isProjectInfoRefreshing;
  const isPublishRunCardRefreshing =
    Boolean(params.selectedRepo) &&
    activeProviderUsesProjectFile &&
    (params.isProjectInfoRefreshing || isResolvingSelectedProjectProfile);

  const handleArtifactStateChange = useCallback(
    (state: ArtifactActionState) => {
      // 异步打包或签名只能更新发起操作的那次发布结果。
      if (usePublishStore.getState().publishResult === params.publishResult) {
        params.setArtifactActionState(state);
      }
    },
    [params.publishResult, params.setArtifactActionState]
  );

  // Memoized publish run card props
  const publishRunCardProps = usePublishRunCardProps({
    outputLog,
    getOutputLogSnapshot,
    publishResult: params.publishResult,
    appT: params.appT,
    publishT: params.publishT,
    configT: params.configT,
    isRefreshing: isPublishRunCardRefreshing,
    selectedRepo: params.selectedRepo,
    publishPreviewCommand,
    preparedRuntime,
    activeRuntime,
    runtimeResult,
    runtimePreparationError,
    // plan 033：发布一律需要 PublishRuntime（命名配置或自动草稿）。
    requiresPreparedRuntime: true,
    isPublishing: params.isPublishing,
    isCancellingPublish: params.isCancellingPublish,
    artifactActionState: params.artifactActionState,
    onArtifactStateChange: handleArtifactStateChange,
    onOpenReleaseChecklist: () => params.setReleaseChecklistOpen(true),
    startPublish,
    cancelPublish,
  });

  // Memoized command import result card props
  const commandImportResultCardProps =
    useMemo<CommandImportResultCardProps | null>(() => {
      if (!activeImportFeedback) {
        return null;
      }
      return {
        activeImportFeedback,
        providerLabel: activeProviderLabel,
        appT: params.appT,
      };
    }, [activeImportFeedback, activeProviderLabel, params.appT]);

  // Derived visibility flags
  const showCommandImportResultCard = Boolean(
    params.selectedRepo && commandImportResultCardProps
  );
  const shouldLoadDiagnosticsSection = params.selectedRepo
    ? params.rightPanelView === "history"
    : false;
  const diagnosticsSectionProps =
    shouldLoadDiagnosticsSection && params.selectedRepo
      ? {
          rightPanelView: params.rightPanelView,
          appT: params.appT,
          historyT: params.historyT,
          failureT: params.failureT,
          executionHistory: params.executionHistory,
          executionHistoryLimit: params.executionHistoryLimit,
          selectedRepo: params.selectedRepo,
          isPublishing: params.isPublishing,
          recentHistoryExports: params.recentHistoryExports,
          trackHistoryExport: params.trackHistoryExport,
          extractSpecFromRecord: params.extractSpecFromRecord,
          rerunFromHistory: params.extractSpecFromRecord as any, // overridden by useAppBoot
        }
      : null;

  // Memoized publish config panel props
  const publishConfigPanelProps = usePublishConfigPanelProps({
    selectedRepoId: params.selectedRepoId,
    selection: params.selectedRepo?.publishConfig.selection,
    profiles,
    isProfilesRefreshing: Boolean(params.selectedRepo) && isProfilesRefreshing,
    activeProfileName,
    onSelectProfile: handleSelectProfileFromPanel,
    onCreateProfile: openQuickCreateProfileDialog,
    onEditProfile: handleEditProfileFromPanel,
    onViewProfile: openQuickViewProfileDialog,
    onSaveProfileComposition: handleSaveProfileComposition,
    onRebindProfileProject: handleRebindProfileProject,
    onRefreshProfiles: loadProfiles,
    onOpenConfigDialog: () => params.handleConfigDialogOpenChange(true),
    onDeleteProfile: handleDeleteProfileFromPanel,
    projectPublishProfiles: params.orderedProjectPublishProfiles,
    isProjectProfilesRefreshing,
    projectFilePath: params.projectInfo?.project_file,
    projectFrameworkOptions,
    onSelectProjectProfile: handleSelectProjectProfile,
    onCopyProjectProfileToCustom: handleCreateProfileFromProjectProfile,
    recentConfigKeys,
    favoriteConfigKeys,
    onToggleFavoriteConfig: toggleFavoriteConfig,
    onRemoveRecentConfig: removeRecentConfig,
    onReorderRecentConfigs: reorderRecentConfig,
    onReorderProjectProfiles: params.reorderProjectPublishProfiles,
    onReorderProfiles: handleReorderProfiles,
    onCollapse: () => params.setMiddlePanelCollapsed(true),
    showExpandButton: params.leftPanelCollapsed,
    onExpandRepo: () => params.setLeftPanelCollapsed(false),
  });

  return {
    // Publish config from useAppState
    selectionParameters,
    pushRecentPublishConfig: params.pushRecentPublishConfig,
    removeRecentPublishConfig: params.removeRecentPublishConfig,
    reorderRecentPublishConfigs: params.reorderRecentPublishConfigs,
    replaceRecentPublishConfigKey: params.replaceRecentPublishConfigKey,

    // Provider runtime (lifted, re-exported)
    activeProviderId: params.activeProviderId,
    setActiveProviderId: params.setActiveProviderId,
    providerListState: params.providerListState,
    activeProviderSchemaState: params.activeProviderSchemaState,
    retryProviderList: params.retryProviderList,
    retryProviderSchema: params.retryProviderSchema,
    providerSchemas: params.providerSchemas,
    providerRuntimeProviders: params.providerRuntimeProviders,
    activeProvider: params.activeProvider,
    activeProviderParameters: params.activeProviderParameters,
    setProviderParameters: params.setProviderParameters,
    applyProfileProvider: params.applyProfileProvider,
    applySelectedRepositoryProvider: params.applySelectedRepositoryProvider,

    // Scoped configs
    recentConfigKeys,
    favoriteConfigKeys,
    pushRecentConfig,
    removeRecentConfig,
    reorderRecentConfig,
    toggleFavoriteConfig,
    replaceScopedConfigKey,

    // Provider presentation
    activeProviderLabel,
    activeProviderUsesProjectFile,
    activeProviderRequiresProjectBinding,
    repositoryProviders,
    providerRuntimeBanner,

    // Dotnet custom config

    // Command import
    activeImportFeedback,
    handleCommandImport,

    // Project info (from repo, re-exported)
    projectInfo: params.projectInfo,
    isProjectInfoRefreshing: params.isProjectInfoRefreshing,
    scanProject: params.scanProject,

    // Project publish profile ordering (from repo, re-exported)
    orderedProjectPublishProfiles: params.orderedProjectPublishProfiles,
    reorderProjectPublishProfiles: params.reorderProjectPublishProfiles,

    // Profiles
    profiles,
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
    isQuickCreateEditing,
    isQuickCreateViewing,
    loadProfiles,
    openQuickCreateProfileDialog,
    openQuickEditProfileDialog,
    openQuickViewProfileDialog,
    handleQuickCreateProfileOpenChange,
    quickCreateTemplateOptions,
    quickCreateProfileGroupOptions,
    applyQuickCreateTemplate,
    updateQuickCreateProfileParameter,
    handleSelectProjectProfile,
    handleSelectProfileFromPanel,
    handleQuickCreateProfileSave,
    handleDeleteProfileFromPanel,
    handleLoadProfile,
    handleCreateProfileFromProjectProfile,
    handleReorderProfiles,
    profileManagement,

    // Publish history
    executionHistory: params.executionHistory,
    savePublishRecord: params.savePublishRecord,

    // Publish store
    isPublishing: params.isPublishing,
    isCancellingPublish: params.isCancellingPublish,
    publishResult: params.publishResult,
    releaseChecklistOpen: params.releaseChecklistOpen,
    setReleaseChecklistOpen: params.setReleaseChecklistOpen,
    artifactActionState: params.artifactActionState,

    // Publish runner
    outputLog,
    isResolvingSelectedProjectProfile,
    publishPreviewCommand,
    preparedRuntime,
    activeRuntime,
    runtimeResult,
    runtimePreparationError,
    runPublishSpec,
    startPublish,
    cancelPublish,

    // Recoverable spec (from repo, re-exported)
    extractSpecFromRecord: params.extractSpecFromRecord,

    // Derived
    projectFrameworkOptions,
    isProjectProfilesRefreshing,
    isPublishRunCardRefreshing,
    publishConfigPanelProps,
    publishRunCardProps,
    commandImportResultCardProps,
    showCommandImportResultCard,
    shouldLoadDiagnosticsSection,
    diagnosticsSectionProps,

    // Re-exports
    QUICK_CREATE_PROFILE_GROUP_CUSTOM,
    QUICK_CREATE_PROFILE_GROUP_DEFAULT,
  };
}

export type UsePublishBootReturn = ReturnType<typeof usePublishBoot>;
