import type { AppDialogsProps } from "@/components/layout/AppDialogs";
import type { AppUpdaterState } from "@/hooks/useAppUpdater";
import type { EnvironmentStatus } from "@/hooks/useEnvironmentStatus";
import type { Language } from "@/hooks/useI18n";
import type {
  ProviderPublishSpec,
  PublishResult,
} from "@/hooks/usePublishRunner";
import type { PackageResult, SignResult } from "@/lib/artifact";
import type {
  ConfigParameters,
  ConfigProfile,
  ExecutionRecord,
  PublishConfigStore,
} from "@/lib/store";
import type {
  EnvironmentCheckResult,
  EnvironmentCheckSnapshot,
} from "@/lib/environment";
import type { ParameterSchema } from "@/types/parameters";

interface QuickCreateTemplateOption {
  id: string;
  name: string;
  description?: string;
}

interface RerunChecklistState {
  branch: boolean;
  environment: boolean;
  output: boolean;
}

export interface UseAppDialogsPropsParams {
  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;
  environmentDialogOpen: boolean;
  handleEnvironmentDialogOpenChange: (open: boolean) => void;
  environmentDefaultProviderIds: string[];
  environmentInitialCheck: EnvironmentCheckSnapshot | null;
  setEnvironmentLastCheck: (snapshot: EnvironmentCheckSnapshot | null) => void;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  language: Language;
  handleLanguageChange: (language: Language) => void | Promise<void>;
  minimizeToTrayOnClose: boolean;
  setMinimizeToTrayOnClose: (value: boolean) => void;
  defaultOutputDir: string;
  setDefaultOutputDir: (dir: string) => void;
  executionHistoryLimit: number;
  setExecutionHistoryLimit: (limit: number) => void;
  environmentProviderIds: string[];
  setEnvironmentProviderIds: (providerIds: string[]) => void;
  isRerunChecklistEnabled: boolean;
  setIsRerunChecklistEnabled: (value: boolean) => void;
  theme: "light" | "dark" | "auto";
  setTheme: (theme: "light" | "dark" | "auto") => void;
  handleConfigDialogOpenChange: (open: boolean, onClose?: () => void) => void;
  environmentStatus: EnvironmentStatus;
  environmentLastCheck: EnvironmentCheckSnapshot | null;
  environmentSettingsInitialCheck: EnvironmentCheckSnapshot | null;
  currentProviderEnvironmentResult: EnvironmentCheckResult | null;
  openEnvironmentDialog: (
    initialCheck?: EnvironmentCheckSnapshot | null,
    providerIds?: string[]
  ) => void;
  activeProviderId: string;
  updaterState: AppUpdaterState;
  checkForUpdates: () => Promise<void>;
  installAvailableUpdate: () => Promise<void>;
  openUpdaterHelpTarget: (target: "docs" | "template") => Promise<void>;
  rerunChecklistOpen: boolean;
  pendingRerunRecord: ExecutionRecord | null;
  selectedRepoCurrentBranch?: string | null;
  rerunChecklistState: RerunChecklistState;
  rerunT: Record<string, string | undefined>;
  setRerunChecklistOpen: (open: boolean) => void;
  setRerunChecklistState: (state: RerunChecklistState) => void;
  closeRerunChecklistDialog: () => void;
  confirmRerunWithChecklist: () => Promise<void>;
  releaseChecklistOpen: boolean;
  setReleaseChecklistOpen: (open: boolean) => void;
  publishResult: PublishResult | null;
  packageResult: PackageResult | null;
  signResult: SignResult | null;
  handleOpenSettings: () => void;
  selectedRepoExists: boolean;
  commandImportProjectPath: string;
  commandImportOpen: boolean;
  setCommandImportOpen: (open: boolean) => void;
  handleCommandImport: (spec: ProviderPublishSpec) => void;
  quickCreateProfileOpen: boolean;
  quickCreateTemplateId: string;
  quickCreateTemplateOptions: QuickCreateTemplateOption[];
  quickCreateProfileName: string;
  quickCreateProfileGroup: string;
  quickCreateProfileGroupOptions: string[];
  quickCreateProfileCustomGroup: string;
  quickCreateProfileDraft: PublishConfigStore;
  projectFrameworkOptions: string[];
  quickCreateProfileSaving: boolean;
  quickCreateEditing: boolean;
  dotnetSchema?: ParameterSchema;
  quickCreateGroupDefaultValue: string;
  quickCreateGroupCustomValue: string;
  profileT: Record<string, string | undefined>;
  appT: Record<string, string | undefined>;
  cancelLabel: string;
  handleQuickCreateProfileOpenChange: (open: boolean) => void;
  applyQuickCreateTemplate: (id: string) => void;
  setQuickCreateProfileName: (value: string) => void;
  setQuickCreateProfileGroup: (value: string) => void;
  setQuickCreateProfileCustomGroup: (value: string) => void;
  updateQuickCreateProfileDraft: (patch: Partial<PublishConfigStore>) => void;
  handleQuickCreateProfileSave: () => void;
  configDialogOpen: boolean;
  loadProfiles: () => void;
  handleLoadProfile: (profile: ConfigProfile) => void;
  selectedRepoId: string | null;
  currentConfigParameters: ConfigParameters;
}

export function useAppDialogsProps(params: UseAppDialogsPropsParams): AppDialogsProps {
  return {
    shortcuts: {
      open: params.shortcutsOpen,
      onOpenChange: params.setShortcutsOpen,
    },
    environment: {
      dialogOpen: params.environmentDialogOpen,
      onDialogOpenChange: params.handleEnvironmentDialogOpenChange,
      defaultProviderIds: params.environmentDefaultProviderIds,
      initialCheck: params.environmentInitialCheck,
      onChecked: params.setEnvironmentLastCheck,
      onProviderIdsChange: params.setEnvironmentProviderIds,
    },
    settings: {
      open: params.settingsOpen,
      onOpenChange: params.setSettingsOpen,
      language: params.language,
      onLanguageChange: params.handleLanguageChange,
      minimizeToTrayOnClose: params.minimizeToTrayOnClose,
      onMinimizeToTrayOnCloseChange: params.setMinimizeToTrayOnClose,
      defaultOutputDir: params.defaultOutputDir,
      onDefaultOutputDirChange: params.setDefaultOutputDir,
      executionHistoryLimit: params.executionHistoryLimit,
      onExecutionHistoryLimitChange: params.setExecutionHistoryLimit,
      preRerunChecklistEnabled: params.isRerunChecklistEnabled,
      onPreRerunChecklistEnabledChange: params.setIsRerunChecklistEnabled,
      theme: params.theme,
      onThemeChange: params.setTheme,
      onOpenShortcuts: () => params.setShortcutsOpen(true),
      environmentStatus: params.environmentStatus,
      environmentCheckedAt: params.currentProviderEnvironmentResult?.checked_at,
      environmentProviderIds: params.environmentProviderIds,
      environmentInitialCheck: params.environmentSettingsInitialCheck,
      onEnvironmentProviderIdsChange: params.setEnvironmentProviderIds,
      onEnvironmentChecked: params.setEnvironmentLastCheck,
      updaterState: params.updaterState,
      onCheckForUpdates: params.checkForUpdates,
      onInstallAvailableUpdate: params.installAvailableUpdate,
      onOpenUpdaterHelpTarget: params.openUpdaterHelpTarget,
    },
    rerun: {
      open: params.rerunChecklistOpen,
      pendingRecord: params.pendingRerunRecord,
      selectedRepoCurrentBranch: params.selectedRepoCurrentBranch,
      environmentStatus: params.environmentStatus,
      checklistState: params.rerunChecklistState,
      translations: params.rerunT,
      onOpenChange: params.setRerunChecklistOpen,
      onChecklistStateChange: params.setRerunChecklistState,
      onClose: params.closeRerunChecklistDialog,
      onConfirm: () => void params.confirmRerunWithChecklist(),
    },
    release: {
      open: params.releaseChecklistOpen,
      onOpenChange: params.setReleaseChecklistOpen,
      publishResult: params.publishResult,
      environmentResult: params.currentProviderEnvironmentResult,
      packageResult: params.packageResult,
      signResult: params.signResult,
      onOpenEnvironment: () =>
        params.openEnvironmentDialog(params.environmentLastCheck, [
          params.activeProviderId,
        ]),
      onOpenSettings: params.handleOpenSettings,
    },
    commandImport: {
      enabled: params.selectedRepoExists,
      open: params.commandImportOpen,
      onOpenChange: params.setCommandImportOpen,
      providerId: params.activeProviderId,
      projectPath: params.commandImportProjectPath,
      onImport: params.handleCommandImport,
    },
    quickCreate: {
      open: params.quickCreateProfileOpen,
      templateId: params.quickCreateTemplateId,
      templateOptions: params.quickCreateTemplateOptions,
      profileName: params.quickCreateProfileName,
      profileGroup: params.quickCreateProfileGroup,
      profileGroupOptions: params.quickCreateProfileGroupOptions,
      profileCustomGroup: params.quickCreateProfileCustomGroup,
      profileDraft: params.quickCreateProfileDraft,
      projectFrameworkOptions: params.projectFrameworkOptions,
      saving: params.quickCreateProfileSaving,
      editing: params.quickCreateEditing,
      dotnetSchema: params.dotnetSchema,
      groupDefaultValue: params.quickCreateGroupDefaultValue,
      groupCustomValue: params.quickCreateGroupCustomValue,
      profileT: params.profileT,
      appT: params.appT,
      cancelLabel: params.cancelLabel,
      onOpenChange: params.handleQuickCreateProfileOpenChange,
      onApplyTemplate: params.applyQuickCreateTemplate,
      onProfileNameChange: params.setQuickCreateProfileName,
      onProfileGroupChange: params.setQuickCreateProfileGroup,
      onProfileCustomGroupChange: params.setQuickCreateProfileCustomGroup,
      onDraftChange: params.updateQuickCreateProfileDraft,
      onSave: params.handleQuickCreateProfileSave,
    },
    config: {
      open: params.configDialogOpen,
      onOpenChange: (open) =>
        params.handleConfigDialogOpenChange(open, params.loadProfiles),
      onLoadProfile: params.handleLoadProfile,
      currentProviderId: params.activeProviderId,
      repoId: params.selectedRepoId,
      currentParameters: params.currentConfigParameters,
      onProfilesChanged: params.loadProfiles,
    },
  };
}
