import { Suspense, lazy, useMemo } from "react";
import {
  getEnvironmentCheckSnapshotResult,
  matchesEnvironmentCheckSnapshot,
  type EnvironmentCheckSnapshot,
} from "@/lib/environment";
import type {
  ConfigProfile,
  ExecutionRecord,
  PublishConfigStore,
} from "@/lib/store";
import type { AppUpdaterState } from "@/hooks/useAppUpdater";
import type { PublishResult } from "@/hooks/usePublishRunner";
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
  shortcutsOpen: boolean;
  onShortcutsOpenChange: (open: boolean) => void;
  environmentDialogOpen: boolean;
  onEnvironmentDialogOpenChange: (open: boolean) => void;
  environmentDefaultProviderIds: string[];
  environmentInitialCheck: EnvironmentCheckSnapshot | null;
  environmentLastCheck: EnvironmentCheckSnapshot | null;
  onEnvironmentChecked: (snapshot: EnvironmentCheckSnapshot) => void;
  environmentProviderIds: string[];
  onEnvironmentProviderIdsChange: (providerIds: string[]) => void;
  settingsOpen: boolean;
  onSettingsOpenChange: (open: boolean) => void;
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
  onOpenConfig: () => void;
  environmentStatus: "unknown" | "ready" | "warning" | "blocked";
  environmentCheckedAt?: string;
  onOpenEnvironment: () => void;
  rerunChecklistOpen: boolean;
  pendingRerunRecord: ExecutionRecord | null;
  selectedRepoCurrentBranch?: string | null;
  rerunChecklistState: RerunChecklistState;
  rerunT: Record<string, string | undefined>;
  onRerunChecklistOpenChange: (open: boolean) => void;
  onRerunChecklistStateChange: (state: RerunChecklistState) => void;
  onRerunChecklistClose: () => void;
  onRerunChecklistConfirm: () => void;
  releaseChecklistOpen: boolean;
  onReleaseChecklistOpenChange: (open: boolean) => void;
  publishResult: PublishResult | null;
  packageResult: any;
  signResult: any;
  onReleaseChecklistOpenEnvironment: () => void;
  onReleaseChecklistOpenSettings: () => void;
  selectedRepoExists: boolean;
  commandImportProjectPath: string;
  commandImportOpen: boolean;
  onCommandImportOpenChange: (open: boolean) => void;
  activeProviderId: string;
  onCommandImport: (spec: any) => void;
  updaterState: AppUpdaterState;
  onCheckForUpdates: () => Promise<void>;
  onInstallAvailableUpdate: () => Promise<void>;
  onOpenUpdaterHelpTarget: (target: "docs" | "template") => Promise<void>;
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
  onQuickCreateOpenChange: (open: boolean) => void;
  onApplyTemplate: (id: string) => void;
  onProfileNameChange: (value: string) => void;
  onProfileGroupChange: (value: string) => void;
  onProfileCustomGroupChange: (value: string) => void;
  onDraftChange: (patch: Partial<PublishConfigStore>) => void;
  onQuickCreateSave: () => void;
  configDialogOpen: boolean;
  onConfigDialogOpenChange: (open: boolean) => void;
  onLoadProfile: (profile: ConfigProfile) => void;
  currentProviderId: string;
  repoId: string | null;
  currentParameters: Record<string, any>;
  onProfilesChanged: () => void | Promise<void>;
}

export function AppDialogs(props: AppDialogsProps) {
  const environmentSettingsInitialCheck = useMemo(
    () =>
      matchesEnvironmentCheckSnapshot(
        props.environmentLastCheck,
        props.environmentProviderIds
      )
        ? props.environmentLastCheck
        : null,
    [props.environmentLastCheck, props.environmentProviderIds]
  );

  const currentProviderEnvironmentResult = useMemo(
    () =>
      getEnvironmentCheckSnapshotResult(props.environmentLastCheck, [
        props.activeProviderId,
      ]),
    [props.activeProviderId, props.environmentLastCheck]
  );

  return (
    <>
      {props.shortcutsOpen ? (
        <Suspense fallback={null}>
          <ShortcutsDialog
            open={props.shortcutsOpen}
            onOpenChange={props.onShortcutsOpenChange}
          />
        </Suspense>
      ) : null}

      {props.environmentDialogOpen ? (
        <Suspense fallback={null}>
          <EnvironmentCheckDialog
            open={props.environmentDialogOpen}
            onOpenChange={(open) => {
              props.onEnvironmentDialogOpenChange(open);
            }}
            defaultProviderIds={props.environmentDefaultProviderIds}
            initialCheck={props.environmentInitialCheck}
            onChecked={props.onEnvironmentChecked}
            onProviderIdsChange={props.onEnvironmentProviderIdsChange}
          />
        </Suspense>
      ) : null}

      {props.settingsOpen ? (
        <Suspense fallback={null}>
          <SettingsDialog
            open={props.settingsOpen}
            onOpenChange={props.onSettingsOpenChange}
            language={props.language}
            onLanguageChange={props.onLanguageChange}
            minimizeToTrayOnClose={props.minimizeToTrayOnClose}
            onMinimizeToTrayOnCloseChange={props.onMinimizeToTrayOnCloseChange}
            defaultOutputDir={props.defaultOutputDir}
            onDefaultOutputDirChange={props.onDefaultOutputDirChange}
            executionHistoryLimit={props.executionHistoryLimit}
            onExecutionHistoryLimitChange={props.onExecutionHistoryLimitChange}
            preRerunChecklistEnabled={props.preRerunChecklistEnabled}
            onPreRerunChecklistEnabledChange={props.onPreRerunChecklistEnabledChange}
            theme={props.theme}
            onThemeChange={props.onThemeChange}
            onOpenShortcuts={props.onOpenShortcuts}
            environmentStatus={props.environmentStatus}
            environmentCheckedAt={props.environmentCheckedAt}
            environmentProviderIds={props.environmentProviderIds}
            environmentInitialCheck={environmentSettingsInitialCheck}
            onEnvironmentProviderIdsChange={props.onEnvironmentProviderIdsChange}
            onEnvironmentChecked={props.onEnvironmentChecked}
            updaterState={props.updaterState}
            onCheckForUpdates={props.onCheckForUpdates}
            onInstallAvailableUpdate={props.onInstallAvailableUpdate}
            onOpenUpdaterHelpTarget={props.onOpenUpdaterHelpTarget}
          />
        </Suspense>
      ) : null}

      {props.rerunChecklistOpen ? (
        <Suspense fallback={null}>
          <RerunChecklistDialog
            open={props.rerunChecklistOpen}
            pendingRerunRecord={props.pendingRerunRecord}
            selectedRepoCurrentBranch={props.selectedRepoCurrentBranch}
            environmentStatus={props.environmentStatus}
            rerunChecklistState={props.rerunChecklistState}
            rerunT={props.rerunT}
            onOpenChange={(open) => {
              if (open) {
                props.onRerunChecklistOpenChange(true);
                return;
              }
              props.onRerunChecklistClose();
            }}
            onChecklistStateChange={props.onRerunChecklistStateChange}
            onClose={props.onRerunChecklistClose}
            onConfirm={props.onRerunChecklistConfirm}
          />
        </Suspense>
      ) : null}

      {props.releaseChecklistOpen ? (
        <Suspense fallback={null}>
          <ReleaseChecklistDialog
            open={props.releaseChecklistOpen}
            onOpenChange={props.onReleaseChecklistOpenChange}
            publishResult={props.publishResult}
            environmentResult={currentProviderEnvironmentResult}
            packageResult={props.packageResult}
            signResult={props.signResult}
            onOpenEnvironment={props.onReleaseChecklistOpenEnvironment}
            onOpenSettings={props.onReleaseChecklistOpenSettings}
          />
        </Suspense>
      ) : null}

      {props.selectedRepoExists &&
      props.commandImportProjectPath &&
      props.commandImportOpen ? (
        <Suspense fallback={null}>
          <CommandImportDialog
            open={props.commandImportOpen}
            onOpenChange={props.onCommandImportOpenChange}
            providerId={props.activeProviderId}
            projectPath={props.commandImportProjectPath}
            onImport={props.onCommandImport}
          />
        </Suspense>
      ) : null}

      {props.quickCreateProfileOpen ? (
        <Suspense fallback={null}>
          <QuickCreateProfileDialog
            open={props.quickCreateProfileOpen}
            quickCreateProfileOpen={props.quickCreateProfileOpen}
            quickCreateTemplateId={props.quickCreateTemplateId}
            quickCreateTemplateOptions={props.quickCreateTemplateOptions}
            quickCreateProfileName={props.quickCreateProfileName}
            quickCreateProfileGroup={props.quickCreateProfileGroup}
            quickCreateProfileGroupOptions={props.quickCreateProfileGroupOptions}
            quickCreateProfileCustomGroup={props.quickCreateProfileCustomGroup}
            quickCreateProfileDraft={props.quickCreateProfileDraft}
            projectFrameworkOptions={props.projectFrameworkOptions}
            quickCreateProfileSaving={props.quickCreateProfileSaving}
            quickCreateEditing={props.quickCreateEditing}
            dotnetSchema={props.dotnetSchema}
            quickCreateGroupDefaultValue={props.quickCreateGroupDefaultValue}
            quickCreateGroupCustomValue={props.quickCreateGroupCustomValue}
            profileT={props.profileT}
            appT={props.appT}
            cancelLabel={props.cancelLabel}
            onOpenChange={props.onQuickCreateOpenChange}
            onApplyTemplate={props.onApplyTemplate}
            onProfileNameChange={props.onProfileNameChange}
            onProfileGroupChange={props.onProfileGroupChange}
            onProfileCustomGroupChange={props.onProfileCustomGroupChange}
            onDraftChange={props.onDraftChange}
            onSave={props.onQuickCreateSave}
          />
        </Suspense>
      ) : null}

      {props.configDialogOpen ? (
        <Suspense fallback={null}>
          <ConfigDialog
            open={props.configDialogOpen}
            onOpenChange={props.onConfigDialogOpenChange}
            onLoadProfile={props.onLoadProfile}
            currentProviderId={props.currentProviderId}
            repoId={props.repoId}
            currentParameters={props.currentParameters}
            onProfilesChanged={props.onProfilesChanged}
          />
        </Suspense>
      ) : null}
    </>
  );
}
