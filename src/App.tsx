import { Suspense, lazy } from "react";
import { useAppBoot } from "@/hooks/useAppBoot";

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
const MainContentShell = lazy(async () => {
  const mod = await import("@/components/layout/MainContentShell");
  return { default: mod.MainContentShell };
});

function App() {
  const boot = useAppBoot();

  // Show loading state
  if (boot.isStateLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="text-muted-foreground">{boot.appT.loading || "加载中..."}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      {boot.providerRuntimeBanner ? (
        <ProviderRuntimeBanner
          key={boot.providerRuntimeBanner.key}
          title={boot.providerRuntimeBanner.title}
          description={boot.providerRuntimeBanner.description}
          status={boot.providerRuntimeBanner.status}
          retryLabel={boot.appT.retryAction || "重试"}
          onRetry={boot.providerRuntimeBanner.onRetry}
        />
      ) : null}

      {/* Main Content - Three Column Layout (no separate title bar) */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel - Repository List */}
        <SidebarPanelShell
          collapsed={boot.leftPanelCollapsed}
          width={`${boot.effectiveLeftPanelWidth}px`}
        >
          <Suspense fallback={<div className="flex h-full flex-col" />}>
            <RepositoryList
              repositories={boot.repositories}
              selectedRepoId={boot.selectedRepoId}
              providers={boot.repositoryProviders}
              onSelectRepo={boot.selectRepository}
              onAddRepo={boot.handleAddRepo}
              onOpenRepoDirectory={boot.handleOpenRepoDirectory}
              onEditRepo={boot.handleEditRepo}
              onRemoveRepo={boot.handleRemoveRepo}
              onDetectProvider={boot.handleDetectRepoProvider}
              onScanProjectCandidates={boot.handleScanProjectCandidates}
              onRefreshBranches={boot.handleRefreshRepoBranches}
              branchConnectivityByRepoId={boot.branchConnectivityByRepoId}
              onSettings={boot.handleOpenSettings}
              onCollapse={() => boot.setLeftPanelCollapsed(true)}
              onReorderRepositories={boot.reorderRepositories}
            />
          </Suspense>
        </SidebarPanelShell>

        {/* Left Resize Handle */}
        {!boot.leftPanelCollapsed && (
          <ResizeHandle onResize={boot.handleLeftPanelResize} showHeaderBorder={false} />
        )}

        {/* Middle Panel - Publish Config */}
        <SidebarPanelShell
          collapsed={boot.middlePanelCollapsed}
          width={`${boot.effectiveMiddlePanelWidth}px`}
        >
          <Suspense fallback={<div className="flex h-full flex-col" />}>
            <PublishConfigPanel
              selectedRepoId={boot.selectedRepoId}
              selectedPreset={boot.selectedPreset}
              isCustomMode={boot.isCustomMode}
              profiles={boot.profiles}
              isProfilesRefreshing={Boolean(boot.selectedRepo) && boot.isProfilesRefreshing}
              activeProfileName={boot.activeProfileName}
              onSelectProfile={boot.handleSelectProfileFromPanel}
              onCreateProfile={boot.openQuickCreateProfileDialog}
              onEditProfile={boot.openQuickEditProfileDialog}
              onRefreshProfiles={boot.loadProfiles}
              onOpenConfigDialog={() => boot.handleConfigDialogOpenChange(true)}
              onDeleteProfile={boot.handleDeleteProfileFromPanel}
              projectPublishProfiles={boot.orderedProjectPublishProfiles}
              isProjectProfilesRefreshing={boot.isProjectProfilesRefreshing}
              projectFilePath={boot.projectInfo?.project_file}
              projectFrameworkOptions={boot.projectFrameworkOptions}
              onSelectProjectProfile={boot.handleSelectProjectProfile}
              onCopyProjectProfileToCustom={boot.handleCreateProfileFromProjectProfile}
              recentConfigKeys={boot.recentConfigKeys}
              favoriteConfigKeys={boot.favoriteConfigKeys}
              onToggleFavoriteConfig={boot.toggleFavoriteConfig}
              onRemoveRecentConfig={boot.removeRecentConfig}
              onReorderRecentConfigs={boot.reorderRecentConfig}
              onReorderProjectProfiles={boot.reorderProjectPublishProfiles}
              onReorderProfiles={boot.handleReorderProfiles}
              onCollapse={() => boot.setMiddlePanelCollapsed(true)}
              showExpandButton={boot.leftPanelCollapsed}
              onExpandRepo={() => boot.setLeftPanelCollapsed(false)}
            />
          </Suspense>
        </SidebarPanelShell>

        {/* Middle Resize Handle */}
        {!boot.middlePanelCollapsed && (
          <ResizeHandle onResize={boot.handleMiddlePanelResize} />
        )}

        {/* Right Panel - Main Content */}
        <Suspense fallback={<div className="flex h-full flex-1 flex-col" />}>
          <MainContentShell
            leftPanelCollapsed={boot.leftPanelCollapsed}
            middlePanelCollapsed={boot.middlePanelCollapsed}
            appT={boot.appT}
            configPanelT={boot.translations.configPanel || {}}
            rightPanelView={boot.rightPanelView}
            onExpandLeftPanel={() => boot.setLeftPanelCollapsed(false)}
            onExpandMiddlePanel={() => boot.setMiddlePanelCollapsed(false)}
            onSelectHomeView={() => boot.setRightPanelView("home")}
            onSelectHistoryView={() => boot.setRightPanelView("history")}
          >
            <Suspense fallback={<div className="flex h-full flex-col" />}>
              <PublishContentSection
                showCommandImportResultCard={boot.showCommandImportResultCard}
                commandImportResultCardProps={boot.commandImportResultCardProps}
                publishRunCardProps={boot.publishRunCardProps}
                shouldLoadDiagnosticsSection={boot.shouldLoadDiagnosticsSection}
                diagnosticsSectionProps={boot.diagnosticsSectionProps}
                rightPanelView={boot.rightPanelView}
              />
            </Suspense>
          </MainContentShell>
        </Suspense>
      </div>

      {boot.shouldLoadAppDialogsHost ? (
        <Suspense fallback={null}>
          <AppDialogsHost
            shortcutsOpen={boot.shortcutsOpen}
            setShortcutsOpen={boot.setShortcutsOpen}
            environmentDialogOpen={boot.environmentDialogOpen}
            handleEnvironmentDialogOpenChange={boot.handleEnvironmentDialogOpenChange}
            environmentDefaultProviderIds={boot.environmentDefaultProviderIds}
            environmentInitialCheck={boot.environmentInitialCheck}
            setEnvironmentLastCheck={boot.setEnvironmentLastCheck}
            settingsOpen={boot.settingsOpen}
            setSettingsOpen={boot.setSettingsOpen}
            language={boot.language}
            handleLanguageChange={boot.handleLanguageChange}
            minimizeToTrayOnClose={boot.minimizeToTrayOnClose}
            setMinimizeToTrayOnClose={boot.setMinimizeToTrayOnClose}
            defaultOutputDir={boot.defaultOutputDir}
            setDefaultOutputDir={boot.setDefaultOutputDir}
            executionHistoryLimit={boot.executionHistoryLimit}
            setExecutionHistoryLimit={boot.setExecutionHistoryLimit}
            environmentProviderIds={boot.environmentProviderIds}
            setEnvironmentProviderIds={boot.setEnvironmentProviderIds}
            isRerunChecklistEnabled={boot.isRerunChecklistEnabled}
            setIsRerunChecklistEnabled={boot.setIsRerunChecklistEnabled}
            theme={boot.theme}
            setTheme={boot.setTheme}
            handleConfigDialogOpenChange={boot.handleConfigDialogOpenChange}
            environmentLastCheck={boot.environmentLastCheck}
            openEnvironmentDialog={boot.openEnvironmentDialog}
            activeProviderId={boot.activeProviderId}
            activeProviderUsesProjectFile={boot.activeProviderUsesProjectFile}
            activeProvider={boot.activeProvider}
            availableProviders={boot.providerRuntimeProviders}
            updaterState={boot.updaterState}
            checkForUpdates={async () => {
              await boot.checkForUpdates();
            }}
            installAvailableUpdate={boot.installAvailableUpdate}
            openUpdaterHelpTarget={boot.openUpdaterHelpTarget}
            rerunChecklistOpen={boot.rerunChecklistOpen}
            pendingRerunRecord={boot.pendingRerunRecord}
            selectedRepoCurrentBranch={boot.selectedRepo?.currentBranch}
            rerunChecklistState={boot.rerunChecklistState}
            rerunT={boot.rerunT}
            setRerunChecklistOpen={boot.setRerunChecklistOpen}
            setRerunChecklistState={boot.setRerunChecklistState}
            closeRerunChecklistDialog={boot.closeRerunChecklistDialog}
            confirmRerunWithChecklist={boot.confirmRerunWithChecklist}
            releaseChecklistOpen={boot.releaseChecklistOpen}
            setReleaseChecklistOpen={boot.setReleaseChecklistOpen}
            publishResult={boot.publishResult}
            packageResult={boot.artifactActionState.packageResult}
            signResult={boot.artifactActionState.signResult}
            handleOpenSettings={boot.handleOpenSettings}
            selectedRepoExists={Boolean(boot.selectedRepo)}
            commandImportOpen={boot.commandImportOpen}
            setCommandImportOpen={boot.setCommandImportOpen}
            handleCommandImport={boot.handleCommandImport}
            quickCreateProfileOpen={boot.quickCreateProfileOpen}
            quickCreateTemplateId={boot.quickCreateTemplateId}
            quickCreateTemplateOptions={boot.quickCreateTemplateOptions}
            quickCreateProfileName={boot.quickCreateProfileName}
            quickCreateProfileGroup={boot.quickCreateProfileGroup}
            quickCreateProfileGroupOptions={boot.quickCreateProfileGroupOptions}
            quickCreateProfileCustomGroup={boot.quickCreateProfileCustomGroup}
            quickCreateProfileDraft={boot.quickCreateProfileDraft}
            projectFrameworkOptions={boot.projectFrameworkOptions}
            quickCreateProfileSaving={boot.quickCreateProfileSaving}
            quickCreateEditing={boot.isQuickCreateEditing}
            dotnetSchema={boot.providerSchemas.dotnet}
            quickCreateGroupDefaultValue={boot.QUICK_CREATE_PROFILE_GROUP_DEFAULT}
            quickCreateGroupCustomValue={boot.QUICK_CREATE_PROFILE_GROUP_CUSTOM}
            profileT={boot.profileT}
            appT={boot.appT}
            cancelLabel={boot.rerunT.cancel || "取消"}
            handleQuickCreateProfileOpenChange={boot.handleQuickCreateProfileOpenChange}
            applyQuickCreateTemplate={boot.applyQuickCreateTemplate}
            setQuickCreateProfileName={boot.setQuickCreateProfileName}
            setQuickCreateProfileGroup={boot.setQuickCreateProfileGroup}
            setQuickCreateProfileCustomGroup={boot.setQuickCreateProfileCustomGroup}
            updateQuickCreateProfileDraft={boot.updateQuickCreateProfileDraft}
            handleQuickCreateProfileSave={boot.handleQuickCreateProfileSave}
            configDialogOpen={boot.configDialogOpen}
            profileManagement={boot.profileManagement}
            handleLoadProfile={boot.handleLoadProfile}
            selectedRepoId={boot.selectedRepoId}
            customConfig={boot.customConfig}
            activeProviderParameters={boot.activeProviderParameters}
            projectFile={boot.projectInfo?.project_file}
            selectedRepoPath={boot.selectedRepo?.path}
          />
        </Suspense>
      ) : null}
    </div>
  );
}


export default App;