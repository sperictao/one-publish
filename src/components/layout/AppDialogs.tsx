import { Suspense, lazy } from "react";
import type {
  EnvironmentCheckResult,
  EnvironmentCheckSnapshot,
} from "@/features/environment/environment";
import type {
  ConfigParameters,
  ConfigProfile,
  ExecutionRecord,
  ProviderManifest,
  PublishConfigStore,
} from "@/lib/store/types";
import type { PackageResult, SignResult } from "@/lib/artifact";
import type { AppUpdaterState } from "@/hooks/useAppUpdater";
import type {
  ProviderPublishSpec,
  PublishResult,
} from "@/features/publish/publishRuntime";
import type { ProfileManagementActions } from "@/features/config/useProfiles";
import type { Language } from "@/hooks/useI18n";
import type { ParameterSchema } from "@/types/parameters";

const ShortcutsDialog = lazy(async () => {
  const mod = await import("@/components/layout/ShortcutsDialog");
  return { default: mod.ShortcutsDialog };
});

const EnvironmentCheckDialog = lazy(async () => {
  const mod = await import("@/components/environment/EnvironmentCheckDialog");
  return { default: mod.EnvironmentCheckDialog };
});

const SettingsDialog = lazy(async () => {
  const mod = await import("@/components/layout/SettingsDialog");
  return { default: mod.SettingsDialog };
});

const RerunChecklistDialog = lazy(async () => {
  const mod = await import("@/components/publish/RerunChecklistDialog");
  return { default: mod.RerunChecklistDialog };
});

const ReleaseChecklistDialog = lazy(async () => {
  const mod = await import("@/components/release/ReleaseChecklistDialog");
  return { default: mod.ReleaseChecklistDialog };
});

const CommandImportDialog = lazy(async () => {
  const mod = await import("@/components/publish/CommandImportDialog");
  return { default: mod.CommandImportDialog };
});

const QuickCreateProfileDialog = lazy(async () => {
  const mod = await import("@/components/publish/QuickCreateProfileDialog");
  return { default: mod.QuickCreateProfileDialog };
});

const ConfigDialog = lazy(async () => {
  const mod = await import("@/components/publish/ConfigDialog");
  return { default: mod.ConfigDialog };
});

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

export interface AppDialogsProps {
  shortcuts: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  };
  environment: {
    dialogOpen: boolean;
    onDialogOpenChange: (open: boolean) => void;
    providers: ProviderManifest[];
    defaultProviderIds: string[];
    initialCheck: EnvironmentCheckSnapshot | null;
    onChecked: (snapshot: EnvironmentCheckSnapshot) => void;
    onProviderIdsChange: (providerIds: string[]) => void;
  };
  settings: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    language: Language;
    onLanguageChange: (language: Language) => void | Promise<void>;
    minimizeToTrayOnClose: boolean;
    onMinimizeToTrayOnCloseChange: (value: boolean) => void;
    defaultOutputDir: string;
    onDefaultOutputDirChange: (dir: string) => void;
    executionHistoryLimit: number;
    onExecutionHistoryLimitChange: (limit: number) => void;
    preRerunChecklistEnabled: boolean;
    onPreRerunChecklistEnabledChange: (value: boolean) => void;
    theme: "light" | "dark" | "auto";
    onThemeChange: (theme: "light" | "dark" | "auto") => void;
    onOpenShortcuts: () => void;
    environmentStatus: "unknown" | "ready" | "warning" | "blocked";
    environmentCheckedAt?: string;
    providers: ProviderManifest[];
    environmentProviderIds: string[];
    environmentInitialCheck: EnvironmentCheckSnapshot | null;
    onEnvironmentProviderIdsChange: (providerIds: string[]) => void;
    onEnvironmentChecked: (snapshot: EnvironmentCheckSnapshot) => void;
    updaterState: AppUpdaterState;
    onCheckForUpdates: () => Promise<void>;
    onInstallAvailableUpdate: () => Promise<void>;
    onOpenUpdaterHelpTarget: (target: "docs" | "template") => Promise<void>;
  };
  rerun: {
    open: boolean;
    pendingRecord: ExecutionRecord | null;
    selectedRepoCurrentBranch?: string | null;
    environmentStatus: "unknown" | "ready" | "warning" | "blocked";
    checklistState: RerunChecklistState;
    translations: Record<string, string | undefined>;
    onOpenChange: (open: boolean) => void;
    onChecklistStateChange: (state: RerunChecklistState) => void;
    onClose: () => void;
    onConfirm: () => void;
  };
  release: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    publishResult: PublishResult | null;
    environmentResult: EnvironmentCheckResult | null;
    packageResult: PackageResult | null;
    signResult: SignResult | null;
    onOpenEnvironment: () => void;
    onOpenSettings: () => void;
  };
  commandImport: {
    enabled: boolean;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    providerId: string;
    provider: ProviderManifest | null;
    projectPath: string;
    onImport: (spec: ProviderPublishSpec) => void;
  };
  quickCreate: {
    open: boolean;
    templateId: string;
    templateOptions: QuickCreateTemplateOption[];
    profileName: string;
    profileGroup: string;
    profileGroupOptions: string[];
    profileCustomGroup: string;
    profileDraft: PublishConfigStore;
    projectFrameworkOptions: string[];
    saving: boolean;
    editing: boolean;
    dotnetSchema?: ParameterSchema;
    groupDefaultValue: string;
    groupCustomValue: string;
    profileT: Record<string, string | undefined>;
    appT: Record<string, string | undefined>;
    cancelLabel: string;
    onOpenChange: (open: boolean) => void;
    onApplyTemplate: (id: string) => void;
    onProfileNameChange: (value: string) => void;
    onProfileGroupChange: (value: string) => void;
    onProfileCustomGroupChange: (value: string) => void;
    onDraftChange: (patch: Partial<PublishConfigStore>) => void;
    onSave: () => void;
  };
  config: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    profileManagement: ProfileManagementActions;
    onLoadProfile: (profile: ConfigProfile) => void;
    currentProviderId: string;
    repoId: string | null;
    currentParameters: ConfigParameters;
  };
}

export function AppDialogs(props: AppDialogsProps) {
  return (
    <>
      {props.shortcuts.open ? (
        <Suspense fallback={null}>
          <ShortcutsDialog
            open={props.shortcuts.open}
            onOpenChange={props.shortcuts.onOpenChange}
          />
        </Suspense>
      ) : null}

      {props.environment.dialogOpen ? (
        <Suspense fallback={null}>
          <EnvironmentCheckDialog
            open={props.environment.dialogOpen}
            onOpenChange={(open) => {
              props.environment.onDialogOpenChange(open);
            }}
            providers={props.environment.providers}
            defaultProviderIds={props.environment.defaultProviderIds}
            initialCheck={props.environment.initialCheck}
            onChecked={props.environment.onChecked}
            onProviderIdsChange={props.environment.onProviderIdsChange}
          />
        </Suspense>
      ) : null}

      {props.settings.open ? (
        <Suspense fallback={null}>
          <SettingsDialog
            open={props.settings.open}
            onOpenChange={props.settings.onOpenChange}
            language={props.settings.language}
            onLanguageChange={props.settings.onLanguageChange}
            minimizeToTrayOnClose={props.settings.minimizeToTrayOnClose}
            onMinimizeToTrayOnCloseChange={props.settings.onMinimizeToTrayOnCloseChange}
            defaultOutputDir={props.settings.defaultOutputDir}
            onDefaultOutputDirChange={props.settings.onDefaultOutputDirChange}
            executionHistoryLimit={props.settings.executionHistoryLimit}
            onExecutionHistoryLimitChange={props.settings.onExecutionHistoryLimitChange}
            preRerunChecklistEnabled={props.settings.preRerunChecklistEnabled}
            onPreRerunChecklistEnabledChange={props.settings.onPreRerunChecklistEnabledChange}
            theme={props.settings.theme}
            onThemeChange={props.settings.onThemeChange}
            onOpenShortcuts={props.settings.onOpenShortcuts}
            environmentStatus={props.settings.environmentStatus}
            environmentCheckedAt={props.settings.environmentCheckedAt}
            providers={props.settings.providers}
            environmentProviderIds={props.settings.environmentProviderIds}
            environmentInitialCheck={props.settings.environmentInitialCheck}
            onEnvironmentProviderIdsChange={props.settings.onEnvironmentProviderIdsChange}
            onEnvironmentChecked={props.settings.onEnvironmentChecked}
            updaterState={props.settings.updaterState}
            onCheckForUpdates={props.settings.onCheckForUpdates}
            onInstallAvailableUpdate={props.settings.onInstallAvailableUpdate}
            onOpenUpdaterHelpTarget={props.settings.onOpenUpdaterHelpTarget}
          />
        </Suspense>
      ) : null}

      {props.rerun.open ? (
        <Suspense fallback={null}>
          <RerunChecklistDialog
            open={props.rerun.open}
            pendingRerunRecord={props.rerun.pendingRecord}
            selectedRepoCurrentBranch={props.rerun.selectedRepoCurrentBranch}
            environmentStatus={props.rerun.environmentStatus}
            rerunChecklistState={props.rerun.checklistState}
            rerunT={props.rerun.translations}
            onOpenChange={(open) => {
              if (open) {
                props.rerun.onOpenChange(true);
                return;
              }
              props.rerun.onClose();
            }}
            onChecklistStateChange={props.rerun.onChecklistStateChange}
            onClose={props.rerun.onClose}
            onConfirm={props.rerun.onConfirm}
          />
        </Suspense>
      ) : null}

      {props.release.open ? (
        <Suspense fallback={null}>
          <ReleaseChecklistDialog
            open={props.release.open}
            onOpenChange={props.release.onOpenChange}
            publishResult={props.release.publishResult}
            environmentResult={props.release.environmentResult}
            packageResult={props.release.packageResult}
            signResult={props.release.signResult}
            onOpenEnvironment={props.release.onOpenEnvironment}
            onOpenSettings={props.release.onOpenSettings}
          />
        </Suspense>
      ) : null}

      {props.commandImport.enabled &&
      props.commandImport.projectPath &&
      props.commandImport.open ? (
        <Suspense fallback={null}>
          <CommandImportDialog
            open={props.commandImport.open}
            onOpenChange={props.commandImport.onOpenChange}
            providerId={props.commandImport.providerId}
            provider={props.commandImport.provider}
            projectPath={props.commandImport.projectPath}
            onImport={props.commandImport.onImport}
          />
        </Suspense>
      ) : null}

      {props.quickCreate.open ? (
        <Suspense fallback={null}>
          <QuickCreateProfileDialog
            open={props.quickCreate.open}
            quickCreateProfileOpen={props.quickCreate.open}
            quickCreateTemplateId={props.quickCreate.templateId}
            quickCreateTemplateOptions={props.quickCreate.templateOptions}
            quickCreateProfileName={props.quickCreate.profileName}
            quickCreateProfileGroup={props.quickCreate.profileGroup}
            quickCreateProfileGroupOptions={props.quickCreate.profileGroupOptions}
            quickCreateProfileCustomGroup={props.quickCreate.profileCustomGroup}
            quickCreateProfileDraft={props.quickCreate.profileDraft}
            projectFrameworkOptions={props.quickCreate.projectFrameworkOptions}
            quickCreateProfileSaving={props.quickCreate.saving}
            quickCreateEditing={props.quickCreate.editing}
            dotnetSchema={props.quickCreate.dotnetSchema}
            quickCreateGroupDefaultValue={props.quickCreate.groupDefaultValue}
            quickCreateGroupCustomValue={props.quickCreate.groupCustomValue}
            profileT={props.quickCreate.profileT}
            appT={props.quickCreate.appT}
            cancelLabel={props.quickCreate.cancelLabel}
            onOpenChange={props.quickCreate.onOpenChange}
            onApplyTemplate={props.quickCreate.onApplyTemplate}
            onProfileNameChange={props.quickCreate.onProfileNameChange}
            onProfileGroupChange={props.quickCreate.onProfileGroupChange}
            onProfileCustomGroupChange={props.quickCreate.onProfileCustomGroupChange}
            onDraftChange={props.quickCreate.onDraftChange}
            onSave={props.quickCreate.onSave}
          />
        </Suspense>
      ) : null}

      {props.config.open ? (
        <Suspense fallback={null}>
          <ConfigDialog
            open={props.config.open}
            onOpenChange={props.config.onOpenChange}
            profiles={props.config.profileManagement.profiles}
            isProfilesRefreshing={props.config.profileManagement.isRefreshing}
            onRefreshProfiles={props.config.profileManagement.refreshProfiles}
            onSaveProfile={props.config.profileManagement.saveProfile}
            onDeleteProfile={props.config.profileManagement.deleteProfile}
            onExportProfiles={props.config.profileManagement.exportProfiles}
            onApplyImportedProfiles={props.config.profileManagement.applyImportedProfiles}
            onLoadProfile={props.config.onLoadProfile}
            currentProviderId={props.config.currentProviderId}
            repoId={props.config.repoId}
            currentParameters={props.config.currentParameters}
          />
        </Suspense>
      ) : null}
    </>
  );
}
