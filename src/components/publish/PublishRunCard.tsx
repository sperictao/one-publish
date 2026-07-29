import { useCallback, memo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Collapse } from "@/components/ui/collapse";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  Clock3,
  FolderOpen,
  Loader2,
  Play,
  Square,
  Terminal,
  XCircle,
} from "lucide-react";
import type { PublishResult } from "@/features/publish/publishRuntime";
import type {
  PreparedPublishRuntime,
  PublishRuntimeResult,
} from "@/generated/tauri-contracts";
import {
  useElapsedTimer,
  formatElapsed,
} from "@/features/publish/useElapsedTimer";
import { PublishLogView } from "@/components/publish/PublishLogView";
import { openOutputDirectory } from "@/lib/store/api";
import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";

export interface PublishRunCardActions {
  publishCommand?: string | null;
  publishCommandLabel?: string;
  startLabel?: string;
  publishingLabel?: string;
  cancelLabel?: string;
  cancellingLabel?: string;
  isPublishing: boolean;
  isCancellingPublish: boolean;
  startDisabled: boolean;
  onStartPublish: () => void;
  onCancelPublish: () => void;
}

export interface PublishRunCardProps {
  outputLog: string;
  getOutputLogSnapshot?: () => string;
  publishResult: PublishResult | null;
  appT: Record<string, string | undefined>;
  publishActions: PublishRunCardActions | null;
  preparedRuntime?: PreparedPublishRuntime | null;
  activeRuntime?: PreparedPublishRuntime | null;
  runtimeResult?: PublishRuntimeResult | null;
  runtimePreparationError?: string | null;
  isRefreshing?: boolean;
}

type PublishVisualState =
  "idle" | "running" | "success" | "partial" | "cancelled" | "failed";

export const PublishRunCard = memo(function PublishRunCard({
  outputLog: currentOutputLog,
  getOutputLogSnapshot,
  publishResult: currentPublishResult,
  preparedRuntime: currentPreparedRuntime = null,
  activeRuntime: currentActiveRuntime = null,
  runtimeResult: currentRuntimeResult = null,
  runtimePreparationError: currentRuntimePreparationError = null,
  appT,
  publishActions: currentPublishActions,
  isRefreshing = false,
}: PublishRunCardProps) {
  const [isOpeningOutputDir, setIsOpeningOutputDir] = useState(false);
  const [logExpanded, setLogExpanded] = useState(false);
  const [warningExpanded, setWarningExpanded] = useState(false);
  const frozenDisplayRef = useRef({
    outputLog: currentOutputLog,
    publishResult: currentPublishResult,
    publishActions: currentPublishActions,
    preparedRuntime: currentPreparedRuntime,
    activeRuntime: currentActiveRuntime,
    runtimeResult: currentRuntimeResult,
    runtimePreparationError: currentRuntimePreparationError,
  });

  if (!isRefreshing) {
    frozenDisplayRef.current = {
      outputLog: currentOutputLog,
      publishResult: currentPublishResult,
      publishActions: currentPublishActions,
      preparedRuntime: currentPreparedRuntime,
      activeRuntime: currentActiveRuntime,
      runtimeResult: currentRuntimeResult,
      runtimePreparationError: currentRuntimePreparationError,
    };
  }

  const outputLog = isRefreshing
    ? frozenDisplayRef.current.outputLog
    : currentOutputLog;
  const legacyPublishResult = isRefreshing
    ? frozenDisplayRef.current.publishResult
    : currentPublishResult;
  const publishActions = isRefreshing
    ? frozenDisplayRef.current.publishActions
    : currentPublishActions;
  const preparedRuntime = isRefreshing
    ? frozenDisplayRef.current.preparedRuntime
    : currentPreparedRuntime;
  const activeRuntime = isRefreshing
    ? frozenDisplayRef.current.activeRuntime
    : currentActiveRuntime;
  const runtimeResult = isRefreshing
    ? frozenDisplayRef.current.runtimeResult
    : currentRuntimeResult;
  const runtimePreparationError = isRefreshing
    ? frozenDisplayRef.current.runtimePreparationError
    : currentRuntimePreparationError;
  const publishResult = legacyPublishResult ?? runtimeResult?.publishResult;
  const isRuntimePending = runtimeResult?.attempt.status === "running";

  const handleOpenOutputDir = useCallback(async () => {
    const outputDir = publishResult?.output_dir?.trim();
    if (!outputDir) {
      return;
    }

    try {
      setIsOpeningOutputDir(true);
      const openedPath = await openOutputDirectory(outputDir);
      toast.success(appT.outputDirectoryOpened || "已打开输出目录", {
        description: openedPath,
      });
    } catch (err) {
      toast.error(appT.openOutputDirectoryFailed || "打开输出目录失败", {
        description: String(err),
      });
    } finally {
      setIsOpeningOutputDir(false);
    }
  }, [appT, publishResult?.output_dir]);

  // 运行耗时：必须在任何早退之前调用（hooks 规则）。running 时实时累加，
  // 完成后组件不卸载故 elapsedMs 保留最后值。
  const isRunning = Boolean(publishActions?.isPublishing || isRuntimePending);
  const elapsedMs = useElapsedTimer(isRunning);

  if (
    !outputLog &&
    !publishResult &&
    !publishActions &&
    !preparedRuntime &&
    !activeRuntime &&
    !runtimeResult &&
    !runtimePreparationError &&
    !isRefreshing
  ) {
    return null;
  }

  // Attempt reducer 是 Runtime 状态的单一事实源；Submitted 等非终态不能
  // 回退到命令级结果并被误报为成功或失败。
  const runtimeVisualState = (
    result: PublishRuntimeResult
  ): PublishVisualState | null => {
    switch (result.attempt.status) {
      case "running":
        return "running";
      case "published":
        return "success";
      case "partial_delivery":
        return "partial";
      case "cancelled":
        return "cancelled";
      case "failed":
        return result.publishResult?.cancelled ? "cancelled" : "failed";
      default:
        return null;
    }
  };

  const publishVisualState: PublishVisualState = publishActions?.isPublishing
    ? "running"
    : ((runtimeResult && runtimeVisualState(runtimeResult)) ??
      (publishResult
        ? publishResult.success
          ? "success"
          : publishResult.cancelled
            ? "cancelled"
            : "failed"
        : "idle"));
  const statusMeta =
    publishVisualState === "running"
      ? {
          label: publishActions?.publishingLabel || "发布中…",
          description:
            appT.publishStatusRunningDetail ||
            "发布命令正在执行，日志会持续追加到下方输出区域。",
          badgeClassName:
            "border-interactive/20 bg-interactive/10 text-interactive",
          panelClassName: "border-interactive/20 bg-card",
          iconWrapClassName:
            "bg-interactive/10 text-interactive ring-1 ring-interactive/15",
          iconClassName: "animate-spin",
          icon: Loader2,
        }
      : publishVisualState === "success"
        ? {
            label: appT.statusSuccess || "成功",
            description:
              appT.publishStatusSuccessDetail ||
              "发布已完成，可直接打开输出目录查看产物。",
            badgeClassName: "status-success",
            panelClassName: "border-success/20 bg-card",
            iconWrapClassName:
              "bg-success/10 text-success ring-1 ring-success/15",
            iconClassName: "",
            icon: CheckCircle2,
          }
        : publishVisualState === "partial"
          ? {
              label: appT.statusPartialDelivery || "部分交付",
              description:
                appT.publishStatusPartialDeliveryDetail ||
                "部分必需路线交付失败，已发布路线的结果保持有效；请查看各路线的状态与错误。",
              badgeClassName: "border-warning/20 bg-warning/10 text-warning",
              panelClassName: "border-warning/20 bg-card",
              iconWrapClassName:
                "bg-warning/10 text-warning ring-1 ring-warning/15",
              iconClassName: "",
              icon: AlertTriangle,
            }
          : publishVisualState === "cancelled"
            ? {
                label: appT.statusCancelled || "已取消",
                description:
                  appT.publishStatusCancelledDetail ||
                  "当前执行已停止，可调整参数后重新发起发布。",
                badgeClassName: "status-cancelled",
                panelClassName: "border-warning/20 bg-card",
                iconWrapClassName:
                  "bg-warning/10 text-warning ring-1 ring-warning/15",
                iconClassName: "",
                icon: Square,
              }
            : publishVisualState === "failed"
              ? {
                  label: appT.statusFailed || "失败",
                  description:
                    appT.publishStatusFailedDetail ||
                    "发布命令已退出，结合下方日志定位失败原因。",
                  badgeClassName: "status-failed",
                  panelClassName: "border-destructive/20 bg-card",
                  iconWrapClassName:
                    "bg-destructive/10 text-destructive ring-1 ring-destructive/15",
                  iconClassName: "",
                  icon: XCircle,
                }
              : {
                  label: appT.publishStatusIdle || "待执行",
                  description:
                    appT.publishStatusIdleDetail ||
                    "命令与参数准备完成，可以开始本次发布。",
                  badgeClassName: "border-border bg-muted text-foreground",
                  panelClassName: "border-border bg-card",
                  iconWrapClassName:
                    "bg-muted text-muted-foreground ring-1 ring-border",
                  iconClassName: "",
                  icon: Clock3,
                };

  const StatusIcon = statusMeta.icon;
  const successFileCount =
    runtimeResult?.attempt.manifest?.artifactCount ??
    publishResult?.file_count ??
    0;

  const elapsedText =
    elapsedMs > 0 && (isRunning || publishResult != null)
      ? formatElapsed(elapsedMs)
      : null;

  const statusFacts: string[] = [];
  if (publishVisualState === "success" && successFileCount > 0) {
    statusFacts.push(`${successFileCount} ${appT.fileCountUnit || "个文件"}`);
  }
  if (elapsedText) {
    statusFacts.push(`${appT.publishElapsedLabel || "用时"} ${elapsedText}`);
  }
  const statusFact = statusFacts.length > 0 ? statusFacts.join(" · ") : null;
  const failureMessage =
    publishVisualState === "failed" || publishVisualState === "partial"
      ? runtimeResult?.attempt.error?.trim() || publishResult?.error?.trim()
      : null;

  // 已有执行结果（success/failed/cancelled）时日志默认收起，让结果摘要成为焦点；
  // idle/running 时保持展开，用户正在看实时日志。
  const logCollapsible = publishResult != null;
  const logEffectiveExpanded = logExpanded || !logCollapsible;
  const logLineCount = outputLog ? outputLog.split("\n").length : 0;
  const logFallbackText = isRefreshing
    ? appT.refreshingPublishCard || "正在刷新发布信息…"
    : appT.noOutput || "无输出";
  const logDisplayText = outputLog || publishResult?.error || logFallbackText;

  // 成功态动作行：主操作=打开输出目录，次操作=重新发布。
  // 其他态保持原有执行/取消结构不变（测试依赖其 className）。
  const isSuccessState = publishVisualState === "success";
  const canOpenOutputDir =
    isSuccessState && !!publishResult?.output_dir?.trim();
  const publishWarnings = [
    ...(runtimeResult?.attempt.warnings ?? []),
    ...(publishResult?.warnings ?? []),
  ].filter((w) => w.trim().length > 0);

  return (
    <Card
      aria-busy={isRefreshing}
      className="relative flex h-full min-h-[24rem] w-full min-w-0 max-w-full flex-col overflow-hidden"
    >
      <CardHeader className="pb-3">
        <CardTitle
          headingLevel="h2"
          className="flex items-center gap-2 text-heading-20"
        >
          <Terminal className="size-5" />
          {appT.outputLogTitle || "执行发布"}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-0 min-w-0 flex-1 flex-col gap-y-3 p-4">
        {/* ① 命令预览：去卡片化，降级为流程中的步骤标注 */}
        {publishActions && publishActions.publishCommand && (
          <div className="min-w-0" data-testid="publish-command-preview">
            <div className="mb-1 text-label-12 text-muted-foreground">
              {publishActions.publishCommandLabel || "将执行的命令:"}
            </div>
            <code className="block rounded-sm bg-muted/60 px-3 py-2 text-label-12 font-mono break-all [overflow-wrap:anywhere]">
              {publishActions.publishCommand}
            </code>
          </div>
        )}

        {preparedRuntime ? (
          <section
            data-testid="publish-runtime-plan"
            className="min-w-0 rounded-sm border border-border bg-muted/20 px-3 py-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SectionLabel as="div">
                {appT.publishRuntimePlanLabel || "本地发布计划"}
              </SectionLabel>
              <span className="font-mono text-label-12 text-muted-foreground">
                {preparedRuntime.configurationRevisionId}
              </span>
            </div>
            <dl className="mt-2 grid min-w-0 gap-1 text-label-12 sm:grid-cols-2">
              <div className="min-w-0">
                <dt className="text-muted-foreground">
                  {appT.publishRuntimePlanDigestLabel || "Plan Digest"}
                </dt>
                <dd className="truncate font-mono">
                  {preparedRuntime.plan.digest}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-muted-foreground">
                  {appT.publishRuntimeBackendLabel || "Execution Backend"}
                </dt>
                <dd className="truncate font-mono">
                  {preparedRuntime.plan.executionBackend}
                </dd>
              </div>
            </dl>
            <ol className="mt-2 flex flex-wrap gap-1.5">
              {preparedRuntime.plan.nodes.map((node) => (
                <li
                  key={node.id}
                  className="rounded-sm border border-border bg-background px-2 py-1 font-mono text-label-12 text-muted-foreground"
                >
                  {node.stage}
                </li>
              ))}
            </ol>
            {preparedRuntime.blockedReason ? (
              <div
                role="alert"
                className="mt-2 rounded-sm border border-destructive/20 bg-destructive/5 px-3 py-2 text-copy-14 text-destructive"
              >
                {preparedRuntime.blockedReason}
              </div>
            ) : null}
          </section>
        ) : null}

        {!preparedRuntime && runtimePreparationError ? (
          <div
            role="alert"
            className="rounded-sm border border-destructive/20 bg-destructive/5 px-3 py-2 text-copy-14 text-destructive"
          >
            {runtimePreparationError}
          </div>
        ) : null}

        {activeRuntime &&
        activeRuntime.configurationRevisionId !==
          preparedRuntime?.configurationRevisionId ? (
          <div className="rounded-sm border border-interactive/20 bg-interactive/5 px-3 py-2 text-label-12 text-interactive">
            {(appT.publishRuntimeActiveRevisionLabel || "正在执行配置版本") +
              ": " +
              activeRuntime.configurationRevisionId}
          </div>
        ) : null}

        {/* ② 动作行 */}
        {publishActions && (
          <div className="flex flex-col gap-2 sm:flex-row">
            {isSuccessState ? (
              <>
                <Button
                  data-testid="publish-execute-btn"
                  className="w-full text-primary-foreground sm:flex-1"
                  size="lg"
                  onClick={handleOpenOutputDir}
                  disabled={!canOpenOutputDir || isOpeningOutputDir}
                >
                  {isOpeningOutputDir ? (
                    <span className="inline-block animate-spin mr-2">
                      <Loader2 className="size-5" />
                    </span>
                  ) : (
                    <FolderOpen className="size-5 mr-2" />
                  )}
                  {appT.openOutputDirLabel || "打开输出目录"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="w-full sm:w-auto sm:min-w-32"
                  onClick={publishActions.onStartPublish}
                  disabled={publishActions.startDisabled}
                >
                  <Play className="size-4 mr-2" />
                  {appT.republishLabel || "重新发布"}
                </Button>
              </>
            ) : (
              <>
                <Button
                  data-testid="publish-execute-btn"
                  className={cn(
                    "w-full text-primary-foreground sm:flex-1",
                    publishActions.isPublishing &&
                      "border border-interactive/20 bg-interactive/10 text-interactive shadow-none disabled:opacity-100"
                  )}
                  size="lg"
                  onClick={publishActions.onStartPublish}
                  disabled={
                    publishActions.isPublishing ||
                    (!isRuntimePending && publishActions.startDisabled)
                  }
                >
                  {publishActions.isPublishing ? (
                    <>
                      <span className="inline-block animate-spin mr-2">
                        <Loader2 className="size-5" />
                      </span>
                      {publishActions.publishingLabel || "发布中…"}
                    </>
                  ) : isRuntimePending ? (
                    <>
                      <Play className="size-5 mr-2" />
                      {appT.resumePublishLabel || "继续发布"}
                    </>
                  ) : (
                    <>
                      <Play className="size-5 mr-2" />
                      {publishActions.startLabel || "执行发布"}
                    </>
                  )}
                </Button>
                {(publishActions.isPublishing || isRuntimePending) && (
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    className="w-full border-destructive/30 bg-destructive/5 text-destructive hover:bg-destructive/10 hover:text-destructive disabled:bg-gray-100 disabled:text-gray-700 sm:w-auto sm:min-w-32"
                    onClick={publishActions.onCancelPublish}
                    disabled={publishActions.isCancellingPublish}
                  >
                    {publishActions.isCancellingPublish ? (
                      <>
                        <span className="inline-block animate-spin mr-2">
                          <Loader2 className="size-4" />
                        </span>
                        {publishActions.cancellingLabel || "取消中…"}
                      </>
                    ) : (
                      <>
                        <Square className="size-4 mr-2" />
                        {publishActions.cancelLabel || "取消发布"}
                      </>
                    )}
                  </Button>
                )}
              </>
            )}
          </div>
        )}

        {/* ③ 发布结果摘要：状态 + 文件数 + 输出目录三合一 */}
        <div className="min-w-0 space-y-2">
          <output
            data-testid="publish-status-panel"
            aria-live="polite"
            className={cn(
              "block w-full rounded-sm border p-4 transition-colors duration-150 ease-geist",
              statusMeta.panelClassName
            )}
          >
            <div className="flex min-w-0 items-start gap-3">
              <span
                className={cn(
                  "flex size-10 flex-shrink-0 items-center justify-center rounded-sm transition-colors duration-150 ease-geist",
                  statusMeta.iconWrapClassName
                )}
              >
                <span
                  key={publishVisualState}
                  className={cn(
                    "inline-block animate-fade-in",
                    statusMeta.iconClassName
                  )}
                >
                  <StatusIcon className="size-5" />
                </span>
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-heading-14 text-foreground">
                    {appT.publishStatusLabel || "发布状态"}
                  </span>
                  <span
                    className={cn(
                      "inline-flex min-h-6 items-center gap-2 rounded-full border px-2.5 py-0.5 text-label-12 font-semibold transition-colors duration-150 ease-geist",
                      statusMeta.badgeClassName
                    )}
                  >
                    {statusMeta.label}
                  </span>
                  {statusFact ? (
                    <span className="text-label-12 text-muted-foreground">
                      · {statusFact}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-copy-14 text-muted-foreground">
                  {statusMeta.description}
                </p>
              </div>
            </div>
          </output>

          {/* 成功态：输出目录作为摘要块下方的次要信息行（可点击），不再独立成卡。
              置于 output 元素之外，确保 publish-status-panel 内仅含状态图标。 */}
          {canOpenOutputDir && (
            <button
              type="button"
              className="group flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left transition-colors duration-150 ease-geist hover:bg-gray-alpha-100 focus-ring disabled:cursor-not-allowed disabled:text-gray-700"
              onClick={handleOpenOutputDir}
              disabled={isOpeningOutputDir}
            >
              <span className="flex size-7 flex-shrink-0 items-center justify-center rounded-sm bg-interactive/10 text-interactive">
                {isOpeningOutputDir ? (
                  <span className="inline-block animate-spin">
                    <Loader2 className="size-3.5" />
                  </span>
                ) : (
                  <FolderOpen className="size-3.5" />
                )}
              </span>
              <span className="min-w-0 flex flex-1 flex-col overflow-hidden">
                <SectionLabel as="span">
                  {appT.outputDirectoryLabel || "输出目录"}
                </SectionLabel>
                <span className="truncate font-mono text-label-12 text-muted-foreground transition-colors duration-150 ease-geist group-hover:text-foreground">
                  {publishResult?.output_dir}
                </span>
              </span>
              <ArrowUpRight className="size-4 flex-shrink-0 text-muted-foreground transition-colors duration-150 ease-geist group-hover:text-interactive" />
            </button>
          )}

          {failureMessage ? (
            <div className="rounded-sm border border-destructive/20 bg-destructive/5 px-4 py-3 text-copy-14 text-destructive">
              <SectionLabel className="text-destructive">
                {appT.statusFailed || "失败"}
              </SectionLabel>
              <p className="mt-1 break-words">{failureMessage}</p>
            </div>
          ) : null}

          {runtimeResult ? (
            <section
              data-testid="publish-runtime-result"
              className="rounded-sm border border-border bg-muted/20 px-3 py-3"
            >
              <SectionLabel as="div">
                {appT.publishRuntimeResultLabel || "PublishRuntime 结果"}
              </SectionLabel>
              <dl className="mt-2 grid min-w-0 gap-2 text-label-12 sm:grid-cols-2">
                <div className="min-w-0">
                  <dt className="text-muted-foreground">
                    {appT.publishRuntimeManifestLabel || "Artifact Manifest"}
                  </dt>
                  <dd className="truncate font-mono">
                    {runtimeResult.attempt.manifestDigest || "-"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    {appT.publishRuntimeArtifactCountLabel || "Artifacts"}
                  </dt>
                  <dd>{runtimeResult.attempt.manifest?.artifactCount ?? 0}</dd>
                </div>
              </dl>
              {runtimeResult.attempt.routes.length > 0 ? (
                <div className="mt-2" data-testid="publish-route-results">
                  <SectionLabel as="div">
                    {appT.publishRuntimeRoutesLabel || "交付路线"}
                  </SectionLabel>
                  <ul className="mt-1">
                    {runtimeResult.attempt.routes.map((route) => (
                      <li
                        key={route.routeId}
                        data-testid={`publish-route-${route.routeId}`}
                        className="border-t border-border py-2 text-label-12"
                      >
                        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-mono">{route.routeId}</span>
                          <span className="rounded-full border border-border px-2 py-0.5 text-muted-foreground">
                            {route.required
                              ? appT.publishRouteRequiredLabel || "必需"
                              : appT.publishRouteOptionalLabel || "可选"}
                          </span>
                          <span
                            className={cn(
                              "font-semibold",
                              route.status === "published"
                                ? "text-success"
                                : route.error
                                  ? "text-destructive"
                                  : "text-muted-foreground"
                            )}
                          >
                            {route.status}
                          </span>
                        </div>
                        {route.externalReference ? (
                          <div className="mt-1 truncate font-mono text-muted-foreground">
                            {route.externalReference}
                          </div>
                        ) : null}
                        {route.error ? (
                          <div className="mt-1 break-words text-destructive">
                            {route.error}
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {runtimeResult.attempt.receipts.map((receipt) => (
                <div
                  key={receipt.receiptId}
                  className="mt-2 grid min-w-0 gap-1 border-t border-border pt-2 text-label-12 sm:grid-cols-2"
                >
                  <span className="truncate font-mono">
                    {receipt.receiptId}
                  </span>
                  <span className="font-semibold">{receipt.status}</span>
                </div>
              ))}
            </section>
          ) : null}

          {/* 发布结果警告摘要：成功但有 warning 时显示，可折叠展开列表 */}
          {publishWarnings.length > 0 && (
            <div className="rounded-sm border border-warning/20 bg-warning/5">
              <button
                type="button"
                onClick={() => setWarningExpanded((v) => !v)}
                aria-expanded={warningExpanded}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors duration-150 ease-geist hover:bg-warning/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <AlertTriangle className="size-4 flex-shrink-0 text-warning" />
                <span className="text-label-12 font-semibold text-warning">
                  {publishWarnings.length}{" "}
                  {appT.publishWarningsLabel || "个警告"}
                </span>
                <ChevronDown
                  className={cn(
                    "ml-auto size-3.5 text-warning transition-transform duration-150 ease-geist",
                    warningExpanded && "rotate-180"
                  )}
                />
              </button>
              <Collapse open={warningExpanded}>
                <ul className="max-h-48 overflow-auto border-t border-warning/20 px-4 py-2 text-label-12 text-warning">
                  {publishWarnings.map((warning, idx) => (
                    <li
                      key={idx}
                      className="break-all border-b border-warning/10 py-1.5 last:border-b-0"
                    >
                      {warning}
                    </li>
                  ))}
                </ul>
              </Collapse>
            </div>
          )}
        </div>

        {/* ④ 终端日志：可折叠，有结果时默认收起 */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {logCollapsible && (
            <button
              type="button"
              onClick={() => setLogExpanded((v) => !v)}
              aria-expanded={logEffectiveExpanded}
              className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-label-12 font-medium text-muted-foreground transition-colors duration-150 ease-geist hover:bg-gray-alpha-100 hover:text-foreground focus-ring"
            >
              <Terminal className="size-3.5" />
              <span>{appT.publishLogTitle || "发布日志"}</span>
              <span className="text-muted-foreground">
                ·{" "}
                {logLineCount > 0
                  ? `${logLineCount} 行`
                  : appT.publishLogEmpty || "暂无日志"}
              </span>
              <ChevronDown
                className={cn(
                  "ml-auto size-3.5 transition-transform duration-150 ease-geist",
                  logEffectiveExpanded && "rotate-180"
                )}
              />
            </button>
          )}
          <div
            className={cn(
              "flex min-h-0 min-w-0 flex-1 flex-col",
              logCollapsible && !logEffectiveExpanded && "hidden",
              !logCollapsible && "min-h-[16rem]"
            )}
          >
            <PublishLogView
              text={logDisplayText}
              getSnapshot={getOutputLogSnapshot ?? (() => logDisplayText)}
              active={isRunning}
              copyLabel={appT.copyLogLabel || "复制日志"}
              copiedLabel={appT.copyLogSuccess || "已复制日志"}
              jumpLabel={appT.publishLogJumpToBottom || "回到底部"}
            />
          </div>
        </div>
      </CardContent>
      {isRefreshing ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/80">
          <div className="flex items-center gap-2 rounded-full bg-card border border-border px-4 py-2 text-label-14 text-foreground">
            <span className="inline-block animate-spin text-interactive">
              <Loader2 className="size-4" />
            </span>
            <span>{appT.refreshingPublishCard || "正在刷新发布信息…"}</span>
          </div>
        </div>
      ) : null}
    </Card>
  );
});
