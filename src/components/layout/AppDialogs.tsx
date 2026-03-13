import { EnvironmentCheckDialog } from "@/components/environment/EnvironmentCheckDialog";
import { SettingsDialog } from "@/components/layout/SettingsDialog";
import { ShortcutsDialog } from "@/components/layout/ShortcutsDialog";
import { CommandImportDialog } from "@/components/publish/CommandImportDialog";
import { ConfigDialog } from "@/components/publish/ConfigDialog";
import { QuickCreateProfileDialog } from "@/components/publish/QuickCreateProfileDialog";
import { RerunChecklistDialog } from "@/components/publish/RerunChecklistDialog";
import { ReleaseChecklistDialog } from "@/components/release/ReleaseChecklistDialog";
import type { EnvironmentCheckResult } from "@/lib/environment";
import type { ConfigProfile, ExecutionRecord } from "@/lib/store";
import type { PublishResult } from "@/hooks/usePublishExecution";
import type { Language } from "@/hooks/useI18n";

interface QuickCreateProfileDraft {
  configuration: string;
  runtime: string;
  outputDir: string;
  selfContained: boolean;
}

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

interface AppDialogsProps {
  shortcutsOpen: boolean;
  onShortcutsOpenChange: (open: boolean) => void;
  environmentDialogOpen: boolean;
  onEnvironmentDialogOpenChange: (open: boolean) => void;
  environmentDefaultProviderIds: string[];
  environmentInitialResult: EnvironmentCheckResult | null;
  onEnvironmentChecked: (result: EnvironmentCheckResult) => void;
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
  quickCreateProfileOpen: boolean;
  quickCreateTemplateId: string;
  quickCreateTemplateOptions: QuickCreateTemplateOption[];
  quickCreateProfileName: string;
  quickCreateProfileGroup: string;
  quickCreateProfileGroupOptions: string[];
  quickCreateProfileCustomGroup: string;
  quickCreateProfileDraft: QuickCreateProfileDraft;
  quickCreateProfileSaving: boolean;
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
  onDraftChange: (patch: Partial<QuickCreateProfileDraft>) => void;
  onQuickCreateSave: () => void;
  configDialogOpen: boolean;
  onConfigDialogOpenChange: (open: boolean) => void;
  onLoadProfile: (profile: ConfigProfile) => void;
  currentProviderId: string;
  repoId: string | null;
  currentParameters: Record<string, any>;
}

export function AppDialogs(props: AppDialogsProps) {
  return (
    <>
      <ShortcutsDialog
        open={props.shortcutsOpen}
        onOpenChange={props.onShortcutsOpenChange}
      />

      <EnvironmentCheckDialog
        open={props.environmentDialogOpen}
        onOpenChange={(open) => {
          props.onEnvironmentDialogOpenChange(open);
        }}
        defaultProviderIds={props.environmentDefaultProviderIds}
        initialResult={props.environmentInitialResult}
        onChecked={props.onEnvironmentChecked}
      />

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
        onOpenConfig={props.onOpenConfig}
        environmentStatus={props.environmentStatus}
        environmentCheckedAt={props.environmentCheckedAt}
        onOpenEnvironment={props.onOpenEnvironment}
      />

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

      <ReleaseChecklistDialog
        open={props.releaseChecklistOpen}
        onOpenChange={props.onReleaseChecklistOpenChange}
        publishResult={props.publishResult}
        environmentResult={props.environmentInitialResult}
        packageResult={props.packageResult}
        signResult={props.signResult}
        onOpenEnvironment={props.onReleaseChecklistOpenEnvironment}
        onOpenSettings={props.onReleaseChecklistOpenSettings}
      />

      {props.selectedRepoExists && props.commandImportProjectPath && (
        <CommandImportDialog
          open={props.commandImportOpen}
          onOpenChange={props.onCommandImportOpenChange}
          providerId={props.activeProviderId}
          projectPath={props.commandImportProjectPath}
          onImport={props.onCommandImport}
        />
      )}

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
        quickCreateProfileSaving={props.quickCreateProfileSaving}
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

      <ConfigDialog
        open={props.configDialogOpen}
        onOpenChange={props.onConfigDialogOpenChange}
        onLoadProfile={props.onLoadProfile}
        currentProviderId={props.currentProviderId}
        repoId={props.repoId}
        currentParameters={props.currentParameters}
      />
    </>
  );
}
