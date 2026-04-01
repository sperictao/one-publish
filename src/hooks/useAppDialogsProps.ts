import type { AppDialogsProps } from "@/components/layout/AppDialogs";
import type { AppUpdaterState } from "@/hooks/useAppUpdater";
import type { EnvironmentStatus } from "@/hooks/useEnvironmentStatus";
import type { Language } from "@/hooks/useI18n";
import type { PublishResult } from "@/hooks/usePublishRunner";
import type {
  ConfigProfile,
  ExecutionRecord,
  PublishConfigStore,
} from "@/lib/store";
import type {
  EnvironmentCheckSnapshot,
} from "@/lib/environment";
import { getEnvironmentCheckSnapshotResult } from "@/lib/environment";
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
  packageResult: any;
  signResult: any;
  handleOpenSettings: () => void;
  selectedRepoExists: boolean;
  commandImportProjectPath: string;
  commandImportOpen: boolean;
  setCommandImportOpen: (open: boolean) => void;
  handleCommandImport: (spec: any) => void;
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
  currentConfigParameters: Record<string, any>;
}

export function useAppDialogsProps(params: UseAppDialogsPropsParams): AppDialogsProps {
  const currentProviderEnvironmentResult = getEnvironmentCheckSnapshotResult(
    params.environmentLastCheck,
    [params.activeProviderId]
  );

  return {
    shortcutsOpen: params.shortcutsOpen,
    onShortcutsOpenChange: params.setShortcutsOpen,
    environmentDialogOpen: params.environmentDialogOpen,
    onEnvironmentDialogOpenChange: params.handleEnvironmentDialogOpenChange,
    environmentDefaultProviderIds: params.environmentDefaultProviderIds,
    environmentInitialCheck: params.environmentInitialCheck,
    environmentLastCheck: params.environmentLastCheck,
    onEnvironmentChecked: params.setEnvironmentLastCheck,
    settingsOpen: params.settingsOpen,
    onSettingsOpenChange: params.setSettingsOpen,
    language: params.language,
    onLanguageChange: params.handleLanguageChange,
    minimizeToTrayOnClose: params.minimizeToTrayOnClose,
    onMinimizeToTrayOnCloseChange: params.setMinimizeToTrayOnClose,
    defaultOutputDir: params.defaultOutputDir,
    onDefaultOutputDirChange: params.setDefaultOutputDir,
    executionHistoryLimit: params.executionHistoryLimit,
    onExecutionHistoryLimitChange: params.setExecutionHistoryLimit,
    environmentProviderIds: params.environmentProviderIds,
    onEnvironmentProviderIdsChange: params.setEnvironmentProviderIds,
    preRerunChecklistEnabled: params.isRerunChecklistEnabled,
    onPreRerunChecklistEnabledChange: params.setIsRerunChecklistEnabled,
    theme: params.theme,
    onThemeChange: params.setTheme,
    onOpenShortcuts: () => params.setShortcutsOpen(true),
    onOpenConfig: () => params.handleConfigDialogOpenChange(true),
    environmentStatus: params.environmentStatus,
    environmentCheckedAt: currentProviderEnvironmentResult?.checked_at,
    onOpenEnvironment: () =>
      params.openEnvironmentDialog(params.environmentLastCheck, [
        params.activeProviderId,
      ]),
    rerunChecklistOpen: params.rerunChecklistOpen,
    pendingRerunRecord: params.pendingRerunRecord,
    selectedRepoCurrentBranch: params.selectedRepoCurrentBranch,
    rerunChecklistState: params.rerunChecklistState,
    rerunT: params.rerunT,
    onRerunChecklistOpenChange: params.setRerunChecklistOpen,
    onRerunChecklistStateChange: params.setRerunChecklistState,
    onRerunChecklistClose: params.closeRerunChecklistDialog,
    onRerunChecklistConfirm: () => void params.confirmRerunWithChecklist(),
    releaseChecklistOpen: params.releaseChecklistOpen,
    onReleaseChecklistOpenChange: params.setReleaseChecklistOpen,
    publishResult: params.publishResult,
    packageResult: params.packageResult,
    signResult: params.signResult,
    onReleaseChecklistOpenEnvironment: () =>
      params.openEnvironmentDialog(params.environmentLastCheck, [
        params.activeProviderId,
      ]),
    onReleaseChecklistOpenSettings: params.handleOpenSettings,
    selectedRepoExists: params.selectedRepoExists,
    commandImportProjectPath: params.commandImportProjectPath,
    commandImportOpen: params.commandImportOpen,
    onCommandImportOpenChange: params.setCommandImportOpen,
    activeProviderId: params.activeProviderId,
    onCommandImport: params.handleCommandImport,
    updaterState: params.updaterState,
    onCheckForUpdates: params.checkForUpdates,
    onInstallAvailableUpdate: params.installAvailableUpdate,
    onOpenUpdaterHelpTarget: params.openUpdaterHelpTarget,
    quickCreateProfileOpen: params.quickCreateProfileOpen,
    quickCreateTemplateId: params.quickCreateTemplateId,
    quickCreateTemplateOptions: params.quickCreateTemplateOptions,
    quickCreateProfileName: params.quickCreateProfileName,
    quickCreateProfileGroup: params.quickCreateProfileGroup,
    quickCreateProfileGroupOptions: params.quickCreateProfileGroupOptions,
    quickCreateProfileCustomGroup: params.quickCreateProfileCustomGroup,
    quickCreateProfileDraft: params.quickCreateProfileDraft,
    projectFrameworkOptions: params.projectFrameworkOptions,
    quickCreateProfileSaving: params.quickCreateProfileSaving,
    quickCreateEditing: params.quickCreateEditing,
    dotnetSchema: params.dotnetSchema,
    quickCreateGroupDefaultValue: params.quickCreateGroupDefaultValue,
    quickCreateGroupCustomValue: params.quickCreateGroupCustomValue,
    profileT: params.profileT,
    appT: params.appT,
    cancelLabel: params.cancelLabel,
    onQuickCreateOpenChange: params.handleQuickCreateProfileOpenChange,
    onApplyTemplate: params.applyQuickCreateTemplate,
    onProfileNameChange: params.setQuickCreateProfileName,
    onProfileGroupChange: params.setQuickCreateProfileGroup,
    onProfileCustomGroupChange: params.setQuickCreateProfileCustomGroup,
    onDraftChange: params.updateQuickCreateProfileDraft,
    onQuickCreateSave: params.handleQuickCreateProfileSave,
    configDialogOpen: params.configDialogOpen,
    onConfigDialogOpenChange: (open) =>
      params.handleConfigDialogOpenChange(open, params.loadProfiles),
    onLoadProfile: params.handleLoadProfile,
    currentProviderId: params.activeProviderId,
    repoId: params.selectedRepoId,
    currentParameters: params.currentConfigParameters,
    onProfilesChanged: params.loadProfiles,
  };
}
