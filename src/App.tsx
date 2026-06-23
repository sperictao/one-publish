import { Suspense, lazy, useEffect, useState } from "react";
import { useAppBoot } from "@/hooks/useAppBoot";
import { isGeistPrototypeVariant } from "@/components/prototype/geistPrototypeVariant";

import { ResizeHandle } from "@/components/layout/ResizeHandle";
import { SidebarPanelShell } from "@/components/layout/SidebarPanelShell";
import { ProviderRuntimeBanner } from "@/components/layout/ProviderRuntimeBanner";

import {
  Loader2,
} from "lucide-react";

const AppDialogsHost = lazy(async () => {
  const mod = await import("@/components/layout/AppDialogsHost");
  return { default: mod.AppDialogsHost };
});
const RepositoryList = lazy(async () => {
  const mod = await import("@/components/layout/RepositoryList");
  return { default: mod.RepositoryList };
});
const PublishConfigPanel = lazy(async () => {
  const mod = await import("@/components/layout/PublishConfigPanel");
  return { default: mod.PublishConfigPanel };
});
const PublishContentSection = lazy(async () => {
  const mod = await import("@/components/layout/PublishContentSection");
  return { default: mod.PublishContentSection };
});
const GeistWorkbenchPrototype = lazy(async () => {
  const mod = await import("@/components/prototype/GeistWorkbenchPrototype");
  return { default: mod.GeistWorkbenchPrototype };
});
const EMPTY_CONFIG_PANEL_TRANSLATIONS: Record<string, string> = {};

const MainContentShell = lazy(async () => {
  const mod = await import("@/components/layout/MainContentShell");
  return { default: mod.MainContentShell };
});

function App() {
  const boot = useAppBoot();
  const [showGeistPrototype, setShowGeistPrototype] =
    useState(() => {
      if (import.meta.env.PROD || typeof window === "undefined") {
        return false;
      }

      const variant = new URLSearchParams(window.location.search).get("variant");
      return isGeistPrototypeVariant(variant);
    });

  useEffect(() => {
    if (import.meta.env.PROD) {
      return;
    }

    const handleLocationChange = () => {
      const variant = new URLSearchParams(window.location.search).get("variant");
      setShowGeistPrototype(isGeistPrototypeVariant(variant));
    };

    window.addEventListener("popstate", handleLocationChange);
    return () => window.removeEventListener("popstate", handleLocationChange);
  }, []);

  // Show loading state
  if (boot.shell.isStateLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <span className="inline-block animate-spin text-interactive">
            <Loader2 className="size-8" />
          </span>
          <span className="text-muted-foreground">{boot.shell.appT.loading || "加载中..."}</span>
        </div>
      </div>
    );
  }

  if (showGeistPrototype && !import.meta.env.PROD) {
    return (
      <div className="flex h-screen flex-col bg-background">
        <Suspense fallback={<div className="flex h-full flex-col" />}>
          <GeistWorkbenchPrototype boot={boot} />
        </Suspense>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      {boot.publish.providerRuntimeBanner ? (
        <ProviderRuntimeBanner
          key={boot.publish.providerRuntimeBanner.key}
          title={boot.publish.providerRuntimeBanner.title}
          description={boot.publish.providerRuntimeBanner.description}
          status={boot.publish.providerRuntimeBanner.status}
          retryLabel={boot.shell.appT.retryAction || "重试"}
          onRetry={boot.publish.providerRuntimeBanner.onRetry}
        />
      ) : null}

      {/* Main Content - Three Column Layout (no separate title bar) */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel - Repository List */}
        <SidebarPanelShell
          collapsed={boot.shell.leftPanelCollapsed}
          width={`${boot.shell.effectiveLeftPanelWidth}px`}
        >
          <Suspense fallback={<div className="flex h-full flex-col" />}>
            <RepositoryList
              repositories={boot.repo.repositories}
              selectedRepoId={boot.repo.selectedRepoId}
              providers={boot.repo.repositoryProviders}
              onSelectRepo={boot.repo.selectRepository}
              onAddRepo={boot.repo.handleAddRepo}
              onOpenRepoDirectory={boot.repo.handleOpenRepoDirectory}
              onEditRepo={boot.repo.handleEditRepo}
              onRemoveRepo={boot.repo.handleRemoveRepo}
              onDetectProvider={boot.repo.handleDetectRepoProvider}
              onScanProjectCandidates={boot.repo.handleScanProjectCandidates}
              onRefreshBranches={boot.repo.handleRefreshRepoBranches}
              branchConnectivityByRepoId={boot.repo.branchConnectivityByRepoId}
              onSettings={boot.shell.handleOpenSettings}
              onCollapse={() => boot.shell.setLeftPanelCollapsed(true)}
              onReorderRepositories={boot.repo.reorderRepositories}
            />
          </Suspense>
        </SidebarPanelShell>

        {/* Left Resize Handle */}
        {!boot.shell.leftPanelCollapsed && (
          <ResizeHandle onResize={boot.shell.handleLeftPanelResize} showHeaderBorder={false} />
        )}

        {/* Middle Panel - Publish Config */}
        <SidebarPanelShell
          collapsed={boot.shell.middlePanelCollapsed}
          width={`${boot.shell.effectiveMiddlePanelWidth}px`}
        >
          <Suspense fallback={<div className="flex h-full flex-col" />}>
            <PublishConfigPanel
              {...boot.publish.publishConfigPanelProps}
            />
          </Suspense>
        </SidebarPanelShell>

        {/* Middle Resize Handle */}
        {!boot.shell.middlePanelCollapsed && (
          <ResizeHandle onResize={boot.shell.handleMiddlePanelResize} />
        )}

        {/* Right Panel - Main Content */}
        <Suspense fallback={<div className="flex h-full flex-1 flex-col" />}>
          <MainContentShell
            leftPanelCollapsed={boot.shell.leftPanelCollapsed}
            middlePanelCollapsed={boot.shell.middlePanelCollapsed}
            appT={boot.shell.appT}
            configPanelT={boot.shell.translations.configPanel || EMPTY_CONFIG_PANEL_TRANSLATIONS}
            rightPanelView={boot.shell.rightPanelView}
            onExpandLeftPanel={() => boot.shell.setLeftPanelCollapsed(false)}
            onExpandMiddlePanel={() => boot.shell.setMiddlePanelCollapsed(false)}
            onSelectHomeView={() => boot.shell.setRightPanelView("home")}
            onSelectHistoryView={() => boot.shell.setRightPanelView("history")}
          >
            <Suspense fallback={<div className="flex h-full flex-col" />}>
              <PublishContentSection
                showCommandImportResultCard={boot.publish.showCommandImportResultCard}
                commandImportResultCardProps={boot.publish.commandImportResultCardProps}
                publishRunCardProps={boot.publish.publishRunCardProps}
                shouldLoadDiagnosticsSection={boot.publish.shouldLoadDiagnosticsSection}
                diagnosticsSectionProps={boot.publish.diagnosticsSectionProps}
                rightPanelView={boot.shell.rightPanelView}
              />
            </Suspense>
          </MainContentShell>
        </Suspense>
      </div>

      {boot.shell.shouldLoadAppDialogsHost ? (
        <Suspense fallback={null}>
          <AppDialogsHost
            shortcutsOpen={boot.shell.shortcutsOpen}
            setShortcutsOpen={boot.shell.setShortcutsOpen}
            environmentDialogOpen={boot.shell.environmentDialogOpen}
            handleEnvironmentDialogOpenChange={boot.shell.handleEnvironmentDialogOpenChange}
            environmentDefaultProviderIds={boot.shell.environmentDefaultProviderIds}
            environmentInitialCheck={boot.shell.environmentInitialCheck}
            setEnvironmentLastCheck={boot.repo.setEnvironmentLastCheck}
            settingsOpen={boot.shell.settingsOpen}
            setSettingsOpen={boot.shell.setSettingsOpen}
            language={boot.shell.language}
            handleLanguageChange={boot.shell.handleLanguageChange}
            minimizeToTrayOnClose={boot.shell.minimizeToTrayOnClose}
            setMinimizeToTrayOnClose={boot.shell.setMinimizeToTrayOnClose}
            defaultOutputDir={boot.shell.defaultOutputDir}
            setDefaultOutputDir={boot.shell.setDefaultOutputDir}
            executionHistoryLimit={boot.shell.executionHistoryLimit}
            setExecutionHistoryLimit={boot.shell.setExecutionHistoryLimit}
            environmentProviderIds={boot.shell.environmentProviderIds}
            setEnvironmentProviderIds={boot.shell.setEnvironmentProviderIds}
            isRerunChecklistEnabled={boot.publish.isRerunChecklistEnabled}
            setIsRerunChecklistEnabled={boot.publish.setIsRerunChecklistEnabled}
            theme={boot.shell.theme}
            setTheme={boot.shell.setTheme}
            handleConfigDialogOpenChange={boot.shell.handleConfigDialogOpenChange}
            environmentLastCheck={boot.repo.environmentLastCheck}
            openEnvironmentDialog={boot.shell.openEnvironmentDialog}
            activeProviderId={boot.publish.activeProviderId}
            activeProviderUsesProjectFile={boot.publish.activeProviderUsesProjectFile}
            activeProvider={boot.publish.activeProvider}
            availableProviders={boot.publish.providerRuntimeProviders}
            updaterState={boot.shell.updaterState}
            checkForUpdates={async () => {
              await boot.shell.checkForUpdates();
            }}
            installAvailableUpdate={boot.shell.installAvailableUpdate}
            openUpdaterHelpTarget={boot.shell.openUpdaterHelpTarget}
            rerunChecklistOpen={boot.publish.rerunChecklistOpen}
            pendingRerunRecord={boot.publish.pendingRerunRecord}
            selectedRepoCurrentBranch={boot.repo.selectedRepo?.currentBranch}
            rerunChecklistState={boot.publish.rerunChecklistState}
            rerunT={boot.shell.rerunT}
            setRerunChecklistOpen={boot.publish.setRerunChecklistOpen}
            setRerunChecklistState={boot.publish.setRerunChecklistState}
            closeRerunChecklistDialog={boot.publish.closeRerunChecklistDialog}
            confirmRerunWithChecklist={boot.publish.confirmRerunWithChecklist}
            releaseChecklistOpen={boot.publish.releaseChecklistOpen}
            setReleaseChecklistOpen={boot.publish.setReleaseChecklistOpen}
            publishResult={boot.publish.publishResult}
            packageResult={boot.publish.artifactActionState.packageResult}
            signResult={boot.publish.artifactActionState.signResult}
            handleOpenSettings={boot.shell.handleOpenSettings}
            selectedRepoExists={Boolean(boot.repo.selectedRepo)}
            commandImportOpen={boot.shell.commandImportOpen}
            setCommandImportOpen={boot.shell.setCommandImportOpen}
            handleCommandImport={boot.publish.handleCommandImport}
            quickCreateProfileOpen={boot.publish.quickCreateProfileOpen}
            quickCreateTemplateId={boot.publish.quickCreateTemplateId}
            quickCreateTemplateOptions={boot.publish.quickCreateTemplateOptions}
            quickCreateProfileName={boot.publish.quickCreateProfileName}
            quickCreateProfileGroup={boot.publish.quickCreateProfileGroup}
            quickCreateProfileGroupOptions={boot.publish.quickCreateProfileGroupOptions}
            quickCreateProfileCustomGroup={boot.publish.quickCreateProfileCustomGroup}
            quickCreateProfileDraft={boot.publish.quickCreateProfileDraft}
            projectFrameworkOptions={boot.publish.projectFrameworkOptions}
            quickCreateProfileSaving={boot.publish.quickCreateProfileSaving}
            quickCreateEditing={boot.publish.isQuickCreateEditing}
            dotnetSchema={boot.publish.providerSchemas.dotnet}
            quickCreateGroupDefaultValue={boot.publish.QUICK_CREATE_PROFILE_GROUP_DEFAULT}
            quickCreateGroupCustomValue={boot.publish.QUICK_CREATE_PROFILE_GROUP_CUSTOM}
            profileT={boot.shell.profileT}
            appT={boot.shell.appT}
            cancelLabel={boot.shell.rerunT.cancel || "取消"}
            handleQuickCreateProfileOpenChange={boot.publish.handleQuickCreateProfileOpenChange}
            applyQuickCreateTemplate={boot.publish.applyQuickCreateTemplate}
            setQuickCreateProfileName={boot.publish.setQuickCreateProfileName}
            setQuickCreateProfileGroup={boot.publish.setQuickCreateProfileGroup}
            setQuickCreateProfileCustomGroup={boot.publish.setQuickCreateProfileCustomGroup}
            updateQuickCreateProfileDraft={boot.publish.updateQuickCreateProfileDraft}
            handleQuickCreateProfileSave={boot.publish.handleQuickCreateProfileSave}
            configDialogOpen={boot.shell.configDialogOpen}
            profileManagement={boot.publish.profileManagement}
            handleLoadProfile={boot.publish.handleLoadProfile}
            selectedRepoId={boot.repo.selectedRepoId}
            customConfig={boot.publish.customConfig}
            activeProviderParameters={boot.publish.activeProviderParameters}
            projectFile={boot.publish.projectInfo?.project_file}
            selectedRepoPath={boot.repo.selectedRepo?.path}
          />
        </Suspense>
      ) : null}
    </div>
  );
}


export default App;
