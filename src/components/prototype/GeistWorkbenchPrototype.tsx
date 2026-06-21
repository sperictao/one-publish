import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileCog,
  FolderGit2,
  GitBranch,
  History,
  Layers3,
  PackageCheck,
  Play,
  Search,
  Settings,
  Terminal,
} from "lucide-react";

import {
  GEIST_PROTOTYPE_VARIANT_LABEL,
} from "@/components/prototype/geistPrototypeVariant";
import type { useAppBoot } from "@/hooks/useAppBoot";
import { cn } from "@/lib/utils";

type AppBootState = ReturnType<typeof useAppBoot>;

interface GeistWorkbenchPrototypeProps {
  boot: AppBootState;
}

interface PrototypeSummary {
  appTitle: string;
  repositoriesCount: number;
  selectedRepoName: string;
  selectedRepoPath: string;
  selectedRepoBranch: string;
  selectedRepoProvider: string;
  profilesCount: number;
  projectProfilesCount: number;
  activeProfileName: string;
  activeProviderLabel: string;
  publishTitle: string;
  publishCommandLabel: string;
  publishCommand: string;
  publishStatus: "idle" | "running" | "success" | "failed" | "cancelled";
  publishStatusLabel: string;
  publishStatusDetail: string;
  outputPreview: string;
  noOutputLabel: string;
  emptyContentLabel: string;
  historyCount: number;
  diagnosticsAvailable: boolean;
  bannerTitle: string | null;
  bannerDescription: string | null;
  isPublishing: boolean;
  isRefreshing: boolean;
}

const statusClassNameByState: Record<PrototypeSummary["publishStatus"], string> = {
  idle: "border-border bg-muted text-foreground",
  running: "border-interactive/20 bg-interactive/10 text-interactive",
  success: "border-success/20 bg-success/10 text-success",
  failed: "border-destructive/20 bg-destructive/10 text-destructive",
  cancelled: "border-warning/25 bg-warning/10 text-warning",
};

function getPrototypeSummary(boot: AppBootState): PrototypeSummary {
  const selectedRepo = boot.repo.selectedRepo;
  const configProps = boot.publish.publishConfigPanelProps;
  const runProps = boot.publish.publishRunCardProps;
  const publishResult = runProps.publishResult;
  const publishActions = runProps.publishActions;
  const appT = runProps.appT;
  const configT = boot.shell.configT;
  const configPanelT = boot.shell.translations.configPanel || {};

  const publishStatus: PrototypeSummary["publishStatus"] =
    publishActions?.isPublishing
      ? "running"
      : publishResult?.cancelled
        ? "cancelled"
        : publishResult?.success
          ? "success"
          : publishResult?.error
            ? "failed"
            : "idle";

  const publishStatusLabel =
    publishStatus === "running"
      ? publishActions?.publishingLabel || configT.publishing || "Publishing"
      : publishStatus === "success"
        ? appT.statusSuccess || "Success"
        : publishStatus === "failed"
          ? appT.statusFailed || "Failed"
          : publishStatus === "cancelled"
            ? appT.statusCancelled || "Cancelled"
            : appT.publishStatusIdle || "Ready";

  const publishStatusDetail =
    publishStatus === "running"
      ? appT.publishStatusRunningDetail ||
        "The publish command is running and logs will continue streaming."
      : publishStatus === "success"
        ? appT.publishStatusSuccessDetail ||
          "Publish completed. You can inspect the output directory."
        : publishStatus === "failed"
          ? publishResult?.error || "Publish failed. Check the log before retrying."
          : publishStatus === "cancelled"
            ? appT.publishStatusCancelledDetail || "Publish cancelled."
            : appT.publishStatusIdleDetail ||
              "The command and parameters are ready. You can start this publish now.";

  return {
    appTitle: boot.shell.appT.appTitle || "One Publish",
    repositoriesCount: boot.repo.repositories.length,
    selectedRepoName: selectedRepo?.name || "No repository selected",
    selectedRepoPath: selectedRepo?.path || "Select a repository to show its path",
    selectedRepoBranch: selectedRepo?.currentBranch || "No branch",
    selectedRepoProvider:
      boot.repo.repositoryProviders.find(
        (provider) => provider.id === selectedRepo?.providerId
      )?.displayName ||
      boot.publish.activeProviderLabel ||
      "dotnet",
    profilesCount: configProps.profiles.length,
    projectProfilesCount: configProps.projectPublishProfiles.length,
    activeProfileName:
      configProps.activeProfileName ||
      (configProps.isCustomMode
        ? configT.customMode || "Custom config"
        : configT.title || "Default config"),
    activeProviderLabel: boot.publish.activeProviderLabel || "dotnet",
    publishTitle: configT.execute || "Execute Publish",
    publishCommandLabel:
      publishActions?.publishCommandLabel || "Command to run",
    publishCommand:
      publishActions?.publishCommand ||
      publishResult?.command.display_command ||
      "dotnet publish <project> -c Release",
    publishStatus,
    publishStatusLabel,
    publishStatusDetail,
    outputPreview:
      runProps.outputLog ||
      publishResult?.output_log ||
      appT.noOutput ||
      "No output",
    noOutputLabel: appT.noOutput || "No output",
    emptyContentLabel: configPanelT.noConfigs || "No content",
    historyCount: boot.publish.executionHistory.length,
    diagnosticsAvailable: Boolean(boot.publish.diagnosticsSectionProps),
    bannerTitle: boot.publish.providerRuntimeBanner?.title ?? null,
    bannerDescription: boot.publish.providerRuntimeBanner?.description ?? null,
    isPublishing: Boolean(publishActions?.isPublishing),
    isRefreshing: Boolean(runProps.isRefreshing),
  };
}

function PrototypeShell({
  boot,
  children,
}: GeistWorkbenchPrototypeProps & { children: React.ReactNode }) {
  const summary = getPrototypeSummary(boot);

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background">
      {summary.bannerTitle ? (
        <div className="border-b border-warning/20 bg-warning/10 px-4 py-2 text-copy-13 text-foreground">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-warning" />
            <span className="font-semibold">{summary.bannerTitle}</span>
            <span className="truncate text-muted-foreground">
              {summary.bannerDescription}
            </span>
          </div>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-2">
        <div className="surface-raised flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg">
          <header className="flex min-h-12 items-center justify-between border-b border-border px-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <PackageCheck className="size-4" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-heading-16">{summary.appTitle}</h1>
                <p className="truncate text-label-12 text-muted-foreground">
                  Prototype - {GEIST_PROTOTYPE_VARIANT_LABEL}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge summary={summary} />
              <button
                type="button"
                className="focus-ring flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 ease-geist hover:bg-accent hover:text-foreground"
                aria-label="Prototype settings preview"
              >
                <Settings className="size-4" />
              </button>
            </div>
          </header>
          {children}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ summary }: { summary: PrototypeSummary }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-label-12 font-semibold",
        statusClassNameByState[summary.publishStatus]
      )}
    >
      {summary.isPublishing ? (
        <Clock3 className="size-3.5 animate-spin" />
      ) : summary.publishStatus === "success" ? (
        <CheckCircle2 className="size-3.5" />
      ) : summary.publishStatus === "failed" ? (
        <AlertTriangle className="size-3.5" />
      ) : (
        <Activity className="size-3.5" />
      )}
      {summary.publishStatusLabel}
    </span>
  );
}

function RepoListPreview({
  boot,
  compact = false,
}: {
  boot: AppBootState;
  compact?: boolean;
}) {
  const selectedRepoId = boot.repo.selectedRepoId;
  const repositories = boot.repo.repositories.slice(0, compact ? 4 : 7);
  const repoT = boot.shell.translations.repositoryList || {};

  return (
    <section className="flex min-h-0 flex-col">
      <PanelHeader
        icon={FolderGit2}
        title={repoT.repositories || "Repositories"}
        meta={`${boot.repo.repositories.length}`}
      />
      <div className="px-3 pb-2">
        <div className="search-input-shell surface-input relative rounded-sm">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <div className="h-8 pl-8 pr-3 text-label-14 text-muted-foreground flex items-center">
            {repoT.searchRepository || "Search repositories"}
          </div>
        </div>
      </div>
      <div className="geist-scrollbar min-h-0 flex-1 space-y-1 overflow-auto px-2 pb-2">
        {repositories.length > 0 ? (
          repositories.map((repo) => (
            <div
              key={repo.id}
              className={cn(
                "rounded-sm border px-3 py-2 transition-colors duration-150 ease-geist",
                repo.id === selectedRepoId
                  ? "border-border bg-muted"
                  : "border-transparent hover:bg-accent"
              )}
            >
              <div className="flex items-start gap-2">
                <span className="mt-0.5 flex size-7 flex-shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <FolderGit2 className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-label-14 font-semibold text-foreground">
                      {repo.name}
                    </span>
                    {repo.providerId ? (
                      <span className="rounded-full bg-interactive/10 px-2 py-0.5 text-label-12 font-semibold text-interactive">
                        {repo.providerId}
                      </span>
                    ) : null}
                  </div>
                  <p className="truncate text-label-12 text-muted-foreground">
                    {repo.path}
                  </p>
                  <div className="mt-1 flex items-center gap-1.5 text-label-12 text-muted-foreground">
                    <GitBranch className="size-3.5" />
                    <span className="truncate">
                      {repo.currentBranch || "No branch"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))
        ) : (
          <EmptyPreview
            icon={FolderGit2}
            title={repoT.noRepositories || "No repositories"}
            detail={repoT.addRepository || "Add repository to start publishing"}
          />
        )}
      </div>
    </section>
  );
}

function ConfigListPreview({
  boot,
  compact = false,
}: {
  boot: AppBootState;
  compact?: boolean;
}) {
  const configProps = boot.publish.publishConfigPanelProps;
  const profiles = configProps.profiles.slice(0, compact ? 4 : 7);
  const appT = boot.shell.appT;
  const configT = boot.shell.configT;
  const configPanelT = boot.shell.translations.configPanel || {};

  return (
    <section className="flex min-h-0 flex-col">
      <PanelHeader
        icon={FileCog}
        title={configT.title || "Publish Config"}
        meta={`${configProps.profiles.length + configProps.projectPublishProfiles.length}`}
      />
      <div className="px-3 pb-2">
        <div className="search-input-shell surface-input relative rounded-sm">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <div className="h-8 pl-8 pr-3 text-label-14 text-muted-foreground flex items-center">
            {configPanelT.searchConfig || "Search configs"}
          </div>
        </div>
      </div>
      <div className="geist-scrollbar min-h-0 flex-1 space-y-4 overflow-auto px-2 pb-2">
        <PreviewGroup
          title={configPanelT.recentlyUsed || "Recently used"}
          count={configProps.recentConfigKeys.length}
          items={configProps.recentConfigKeys.slice(0, compact ? 2 : 3)}
          icon={Clock3}
          activeItem={configProps.activeProfileName}
          emptyLabel={configPanelT.noConfigs || "No content"}
        />
        <PreviewGroup
          title={appT.projectPublishProfiles || "Project publish profiles"}
          count={configProps.projectPublishProfiles.length}
          items={configProps.projectPublishProfiles.slice(0, compact ? 3 : 5)}
          icon={FileCog}
          activeItem={configProps.activeProfileName}
          emptyLabel={configPanelT.noConfigs || "No content"}
        />
        <PreviewGroup
          title={configT.customMode || "Custom configs"}
          count={configProps.profiles.length}
          items={profiles.map((profile) => profile.name)}
          icon={Layers3}
          activeItem={configProps.activeProfileName}
          emptyLabel={configPanelT.noConfigs || "No content"}
        />
      </div>
    </section>
  );
}

function PublishPreview({
  summary,
  mode = "standard",
}: {
  summary: PrototypeSummary;
  mode?: "standard" | "inspector" | "command";
}) {
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4">
      <div
        className={cn(
          "rounded-md border border-border bg-card",
          mode === "command" ? "p-4" : "p-5"
        )}
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex items-center gap-2">
              <Terminal className="size-5 text-foreground" />
              <h2 className="text-heading-20">{summary.publishTitle}</h2>
            </div>
            <p className="max-w-3xl text-copy-14 text-muted-foreground">
              {summary.publishStatusDetail}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge summary={summary} />
            <button
              type="button"
              className={cn(
                "focus-ring inline-flex h-10 items-center gap-2 rounded-sm px-3 text-button-14 font-medium transition-colors duration-150 ease-geist",
                summary.isPublishing
                  ? "border border-interactive/20 bg-interactive/10 text-interactive"
                  : "bg-primary text-primary-foreground hover:bg-primary/90"
              )}
            >
              {summary.isPublishing ? (
                <Clock3 className="size-4 animate-spin" />
              ) : (
                <Play className="size-4" />
              )}
              {summary.isPublishing
                ? summary.publishStatusLabel
                : summary.publishTitle}
            </button>
          </div>
        </div>
        <div className="mt-4 rounded-sm border border-border bg-muted p-3">
          <div className="mb-1 text-label-12 text-muted-foreground">
            {summary.publishCommandLabel}
          </div>
          <code className="block break-all font-mono text-label-12 text-foreground">
            {summary.publishCommand}
          </code>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="geist-scrollbar min-h-[22rem] overflow-auto rounded-md bg-[hsl(var(--terminal-bg))] p-4 font-mono text-label-12 text-[hsl(var(--terminal-fg))]">
          <pre className="whitespace-pre-wrap break-all">
            {summary.outputPreview}
          </pre>
        </div>
        <div className="space-y-3">
          <FactCard label="历史记录" value={`${summary.historyCount}`} icon={History} />
          <FactCard
            label="诊断"
            value={summary.diagnosticsAvailable ? "可用" : "待选择历史"}
            icon={Activity}
          />
          <FactCard
            label="Provider"
            value={summary.activeProviderLabel}
            icon={PackageCheck}
          />
        </div>
      </div>
    </section>
  );
}

function ContextStrip({ summary }: { summary: PrototypeSummary }) {
  return (
    <div className="grid gap-3 border-b border-border bg-muted/40 p-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)]">
      <ContextItem
        icon={FolderGit2}
        label="仓库"
        title={summary.selectedRepoName}
        detail={summary.selectedRepoPath}
      />
      <ContextItem
        icon={GitBranch}
        label="分支"
        title={summary.selectedRepoBranch}
        detail={summary.selectedRepoProvider}
      />
      <ContextItem
        icon={FileCog}
        label="配置"
        title={summary.activeProfileName}
        detail={`${summary.profilesCount} 自定义 · ${summary.projectProfilesCount} 项目配置`}
      />
    </div>
  );
}

function PanelHeader({
  icon: Icon,
  title,
  meta,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  meta?: string;
}) {
  return (
    <div className="flex h-12 items-center justify-between px-3">
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="size-4 text-muted-foreground" />
        <h2 className="truncate text-heading-14">{title}</h2>
      </div>
      {meta ? (
        <span className="rounded-full bg-muted px-2 py-0.5 text-label-12 font-semibold text-muted-foreground">
          {meta}
        </span>
      ) : null}
    </div>
  );
}

function PreviewGroup({
  title,
  count,
  items,
  icon: Icon,
  activeItem,
  emptyLabel,
}: {
  title: string;
  count: number;
  items: string[];
  icon: React.ComponentType<{ className?: string }>;
  activeItem: string | null;
  emptyLabel: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 px-2 text-label-12 font-semibold uppercase tracking-[0.15em] text-muted-foreground">
        <Icon className="size-3.5" />
        <span className="flex-1">{title}</span>
        <span>{count}</span>
      </div>
      <div className="space-y-1">
        {items.length > 0 ? (
          items.map((item) => (
            <div
              key={item}
              className={cn(
                "rounded-sm border px-3 py-2 text-label-14",
                item === activeItem
                  ? "border-interactive/20 bg-interactive/10 text-interactive"
                  : "border-transparent text-foreground hover:bg-accent"
              )}
            >
              <span className="block truncate font-semibold">{item}</span>
            </div>
          ))
        ) : (
          <div className="rounded-sm border border-dashed border-border px-3 py-3 text-copy-13 text-muted-foreground">
            {emptyLabel}
          </div>
        )}
      </div>
    </div>
  );
}

function FactCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="mb-3 flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </div>
      <div className="text-label-12 text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-heading-16">{value}</div>
    </div>
  );
}

function ContextItem({
  icon: Icon,
  label,
  title,
  detail,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-md border border-border bg-card p-3">
      <div className="flex size-9 flex-shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0">
        <div className="text-label-12 text-muted-foreground">{label}</div>
        <div className="truncate text-label-14 font-semibold text-foreground">
          {title}
        </div>
        <div className="truncate text-label-12 text-muted-foreground">
          {detail}
        </div>
      </div>
    </div>
  );
}

function EmptyPreview({
  icon: Icon,
  title,
  detail,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex min-h-36 flex-col items-center justify-center rounded-md border border-dashed border-border p-6 text-center">
      <Icon className="mb-3 size-8 text-muted-foreground/50" />
      <div className="text-label-14 font-semibold text-foreground">{title}</div>
      <div className="mt-1 text-copy-13 text-muted-foreground">{detail}</div>
    </div>
  );
}

function VariantA({ boot }: { boot: AppBootState }) {
  const summary = getPrototypeSummary(boot);

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(16rem,0.8fr)_minmax(17rem,0.9fr)_minmax(0,2.4fr)] gap-2 p-2">
      <div className="surface-raised min-h-0 overflow-hidden rounded-md">
        <RepoListPreview boot={boot} />
      </div>
      <div className="surface-raised min-h-0 overflow-hidden rounded-md">
        <ConfigListPreview boot={boot} />
      </div>
      <div className="min-h-0 overflow-hidden rounded-md border border-border bg-background">
        <div className="flex h-full min-h-0 flex-col">
          <ContextStrip summary={summary} />
          <div className="geist-scrollbar min-h-0 flex-1 overflow-auto p-4">
            <PublishPreview summary={summary} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function GeistWorkbenchPrototype({ boot }: GeistWorkbenchPrototypeProps) {
  return (
    <PrototypeShell boot={boot}>
      <VariantA boot={boot} />
    </PrototypeShell>
  );
}
