import { useCallback, useMemo } from "react";
import { usePublishRunner } from "@/features/publish/usePublishRunner";
import { useProfiles, QUICK_CREATE_PROFILE_GROUP_CUSTOM, QUICK_CREATE_PROFILE_GROUP_DEFAULT } from "@/features/config/useProfiles";
import { useCommandImport } from "@/hooks/useCommandImport";
import { useScopedConfigs } from "@/features/config/useScopedConfigs";
import { useProviderPresentationState } from "@/features/provider/useProviderPresentationState";
import { usePresetText } from "@/hooks/usePresetText";
import { buildDotnetProfileParameters } from "@/features/config/dotnetPublishConfig";
import { DEFAULT_DOTNET_PRESET_ID, DOTNET_PRESETS } from "@/features/config/dotnetPresets";
import type { PublishConfigStore } from "@/lib/store/types";
import type { PublishConfigPanelProps } from "@/components/layout/PublishConfigPanel";
import type { EnvironmentCheckSnapshot } from "@/features/environment/environment";
import type { CommandImportResultCardProps } from "@/components/publish/CommandImportResultCard";
import type { ProviderPublishSpec } from "@/features/publish/publishRuntime";
import type { ParameterValue, ParameterSchema } from "@/types/parameters";
import type { ResourceState } from "@/features/provider/useProviderRuntime";
import type { ProviderManifest, Repository, ProjectInfo, ExecutionRecord } from "@/lib/store/types";

const SPEC_VERSION = 1;
const EMPTY_STRING_LIST: string[] = [];

type RightPanelView = "home" | "history";

interface TranslationMap {
  [key: string]: string | undefined;
}

interface UsePublishBootParams {
  // From useAppState (publish domain)
  selectedPreset: string;
  isCustomMode: boolean;
  customConfig: PublishConfigStore;
  setSelectedPreset: (value: string) => void;
  setIsCustomMode: (value: boolean) => void;
  setCustomConfig: (config: PublishConfigStore) => void;
  recentConfigKeysByRepo: Record<string, string[]>;
  pushRecentPublishConfig: (key: string, repoId?: string | null) => void;
  removeRecentPublishConfig: (key: string, repoId?: string | null) => void;
  reorderRecentPublishConfigs: (keys: string[], repoId?: string | null) => void;
  replaceRecentPublishConfigKey: (previousKey: string, nextKey: string, repoId?: string | null) => void;
  defaultOutputDir: string;
  executionHistoryLimit: number;

  // From shell domain (translations + dialogs)
  configT: TranslationMap;
  publishT: TranslationMap;
  appT: TranslationMap;
  historyT: TranslationMap;
  failureT: TranslationMap;
  rerunT: TranslationMap;
  profileT: TranslationMap;
  language: "zh" | "en";
  openEnvironmentDialog: (initialCheck?: EnvironmentCheckSnapshot | null, providerIds?: string[]) => void;
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
  scanProject: (path?: string, options?: { projectFile?: string }) => Promise<ProjectInfo | null>;
  orderedProjectPublishProfiles: string[];
  reorderProjectPublishProfiles: (orderedNames: string[]) => void;
  extractSpecFromRecord: (record: ExecutionRecord) => ProviderPublishSpec | null;
  restoreSpecToEditor: (spec: ProviderPublishSpec) => void;
  getRecentConfigKeyFromSpec: (spec: ProviderPublishSpec) => string | null;
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
  setProviderParameters: React.Dispatch<React.SetStateAction<Record<string, Record<string, ParameterValue>>>>;
  applyProfileProvider: (providerId: string) => void;
  applyRecoveredSpecProvider: (providerId: string) => void;
  applySelectedRepositoryProvider: (providerId?: string | null) => void;

  // Lifted publish history state
  isRerunChecklistEnabled: boolean;
  setIsRerunChecklistEnabled: (value: boolean) => void;
  executionHistory: ExecutionRecord[];
  savePublishRecord: (record: ExecutionRecord) => void;

  // Lifted publish store state
  isPublishing: boolean;
  isCancellingPublish: boolean;
  publishResult: any;
  releaseChecklistOpen: boolean;
  setReleaseChecklistOpen: (open: boolean) => void;
  artifactActionState: any;
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

  // Dotnet custom config
  const applyDotnetCustomConfig = useCallback(
    (config: PublishConfigStore) => {
      params.setCustomConfig(config);
      params.setIsCustomMode(true);
    },
    [params.setCustomConfig, params.setIsCustomMode]
  );

  // Command import
  const { activeImportFeedback, handleCommandImport } = useCommandImport({
    activeProviderId: params.activeProviderId,
    appT: params.appT,
    providerSchemas: params.providerSchemas,
    onDotnetConfigReplace: applyDotnetCustomConfig,
    setProviderParameters: params.setProviderParameters,
  });

  // Preset text
  const { getPresetText } = usePresetText(params.configT);

  // Profiles
  const profilesState = useProfiles({
    appT: params.appT,
    profileT: params.profileT,
    language: params.language,
    selectedRepoId: params.selectedRepoId,
    activeProviderId: params.activeProviderId,
    providerSchemas: params.providerSchemas,
    applyProfileProvider: params.applyProfileProvider,
    setIsCustomMode: params.setIsCustomMode,
    isCustomMode: params.isCustomMode,
    setSelectedPreset: params.setSelectedPreset,
    setProviderParameters: params.setProviderParameters,
    applyDotnetCustomConfig,
    replaceScopedConfigKey,
    presets: DOTNET_PRESETS,
    defaultPresetId: DEFAULT_DOTNET_PRESET_ID,
    getPresetText,
    buildProfileParameters: buildDotnetProfileParameters,
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
    loadProfiles,
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
  } = profilesState;

  // Publish runner
  const {
    outputLog,
    isResolvingSelectedProjectProfile,
    publishPreviewCommand,
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
    selectedPreset: params.selectedPreset,
    isCustomMode: params.isCustomMode,
    activeProfileName,
    customConfig: params.customConfig,
    defaultOutputDir: params.defaultOutputDir,
    projectInfo: params.projectInfo,
    presets: DOTNET_PRESETS,
    specVersion: SPEC_VERSION,
    pushRecentConfig,
    openEnvironmentDialog: params.openEnvironmentDialog,
    setEnvironmentLastCheck: params.setEnvironmentLastCheck,
    savePublishRecord: params.savePublishRecord,
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

  // Memoized publish run card props
  const publishRunCardProps = useMemo(
    () => ({
      outputLog,
      publishResult: params.publishResult,
      appT: params.appT,
      isRefreshing: isPublishRunCardRefreshing,
      publishActions:
        params.selectedRepo &&
        (activeProviderRequiresProjectBinding ? Boolean(params.projectInfo) : true)
          ? {
              publishCommand: publishPreviewCommand || null,
              publishCommandLabel: params.publishT.command || "将执行的命令:",
              startLabel: params.configT.execute || "执行发布",
              publishingLabel: params.configT.publishing || "发布中...",
              cancelLabel: params.appT.cancelPublish || "取消发布",
              cancellingLabel: params.appT.cancelling || "取消中...",
              isPublishing: params.isPublishing,
              isCancellingPublish: params.isCancellingPublish,
              startDisabled: !params.selectedRepo,
              onStartPublish: startPublish,
              onCancelPublish: cancelPublish,
            }
          : null,
    }),
    [
      activeProviderRequiresProjectBinding,
      params.appT,
      cancelPublish,
      params.configT.execute,
      params.configT.publishing,
      params.isCancellingPublish,
      isPublishRunCardRefreshing,
      params.isPublishing,
      outputLog,
      publishPreviewCommand,
      params.projectInfo,
      params.publishResult,
      params.publishT.command,
      params.selectedRepo,
      startPublish,
    ]
  );

  // Memoized command import result card props
  const commandImportResultCardProps = useMemo<
    CommandImportResultCardProps | null
  >(() => {
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
  const diagnosticsSectionProps = shouldLoadDiagnosticsSection && params.selectedRepo
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
  const publishConfigPanelProps = useMemo<PublishConfigPanelProps>(
    () => ({
      selectedRepoId: params.selectedRepoId,
      selectedPreset: params.selectedPreset,
      isCustomMode: params.isCustomMode,
      profiles,
      isProfilesRefreshing: Boolean(params.selectedRepo) && isProfilesRefreshing,
      activeProfileName,
      onSelectProfile: handleSelectProfileFromPanel,
      onCreateProfile: openQuickCreateProfileDialog,
      onEditProfile: openQuickEditProfileDialog,
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
    }),
    [
      activeProfileName,
      favoriteConfigKeys,
      handleCreateProfileFromProjectProfile,
      params.handleConfigDialogOpenChange,
      handleDeleteProfileFromPanel,
      handleReorderProfiles,
      handleSelectProfileFromPanel,
      handleSelectProjectProfile,
      params.isCustomMode,
      isProfilesRefreshing,
      isProjectProfilesRefreshing,
      params.leftPanelCollapsed,
      loadProfiles,
      openQuickCreateProfileDialog,
      openQuickEditProfileDialog,
      params.orderedProjectPublishProfiles,
      profiles,
      projectFrameworkOptions,
      params.projectInfo?.project_file,
      recentConfigKeys,
      removeRecentConfig,
      params.reorderProjectPublishProfiles,
      reorderRecentConfig,
      params.selectedPreset,
      params.selectedRepo,
      params.selectedRepoId,
      params.setLeftPanelCollapsed,
      params.setMiddlePanelCollapsed,
      toggleFavoriteConfig,
    ]
  );

  return {
    // Publish config from useAppState
    pushRecentPublishConfig: params.pushRecentPublishConfig,
    removeRecentPublishConfig: params.removeRecentPublishConfig,
    reorderRecentPublishConfigs: params.reorderRecentPublishConfigs,
    replaceRecentPublishConfigKey: params.replaceRecentPublishConfigKey,
    selectedPreset: params.selectedPreset,
    isCustomMode: params.isCustomMode,
    customConfig: params.customConfig,
    setSelectedPreset: params.setSelectedPreset,
    setIsCustomMode: params.setIsCustomMode,
    setCustomConfig: params.setCustomConfig,

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
    applyRecoveredSpecProvider: params.applyRecoveredSpecProvider,
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
    applyDotnetCustomConfig,

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
    loadProfiles,
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

    // Publish history
    isRerunChecklistEnabled: params.isRerunChecklistEnabled,
    setIsRerunChecklistEnabled: params.setIsRerunChecklistEnabled,
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
    runPublishSpec,
    startPublish,
    cancelPublish,

    // Recoverable spec (from repo, re-exported)
    extractSpecFromRecord: params.extractSpecFromRecord,
    restoreSpecToEditor: params.restoreSpecToEditor,
    getRecentConfigKeyFromSpec: params.getRecentConfigKeyFromSpec,

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
