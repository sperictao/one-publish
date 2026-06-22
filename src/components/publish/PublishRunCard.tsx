import { useCallback, memo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { openOutputDirectory } from "@/lib/store/api";
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
  publishResult: PublishResult | null;
  appT: Record<string, string | undefined>;
  publishActions: PublishRunCardActions | null;
  isRefreshing?: boolean;
}

type PublishVisualState =
  | "idle"
  | "running"
  | "success"
  | "cancelled"
  | "failed";

export const PublishRunCard = memo(function PublishRunCard({
  outputLog: currentOutputLog,
  publishResult: currentPublishResult,
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
  });

  if (!isRefreshing) {
    frozenDisplayRef.current = {
      outputLog: currentOutputLog,
      publishResult: currentPublishResult,
      publishActions: currentPublishActions,
    };
  }

  const outputLog = isRefreshing
    ? frozenDisplayRef.current.outputLog
    : currentOutputLog;
  const publishResult = isRefreshing
    ? frozenDisplayRef.current.publishResult
    : currentPublishResult;
  const publishActions = isRefreshing
    ? frozenDisplayRef.current.publishActions
    : currentPublishActions;

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

  if (!outputLog && !publishResult && !publishActions && !isRefreshing) {
    return null;
  }

  const publishVisualState: PublishVisualState = publishActions?.isPublishing
    ? "running"
    : publishResult
      ? publishResult.success
        ? "success"
        : publishResult.cancelled
          ? "cancelled"
          : "failed"
      : "idle";

  const statusMeta =
    publishVisualState === "running"
      ? {
          label: publishActions?.publishingLabel || "发布中...",
          description:
            appT.publishStatusRunningDetail ||
            "发布命令正在执行，日志会持续追加到下方输出区域。",
          badgeClassName:
            "border-interactive/20 bg-interactive/10 text-interactive",
          panelClassName:
            "border-interactive/20 bg-card",
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
            badgeClassName:
              "status-success",
            panelClassName:
              "border-success/20 bg-card",
            iconWrapClassName:
              "bg-success/10 text-success ring-1 ring-success/15",
            iconClassName: "",
            icon: CheckCircle2,
          }
        : publishVisualState === "cancelled"
          ? {
              label: appT.statusCancelled || "已取消",
              description:
                appT.publishStatusCancelledDetail ||
                "当前执行已停止，可调整参数后重新发起发布。",
              badgeClassName:
                "status-cancelled",
              panelClassName:
                "border-warning/20 bg-card",
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
                  "发布命令已退出，请结合下方日志定位失败原因。",
                badgeClassName:
                  "status-failed",
                panelClassName:
                  "border-destructive/20 bg-card",
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
                badgeClassName:
                  "border-border bg-muted text-foreground",
                panelClassName:
                  "border-border bg-card",
                iconWrapClassName:
                  "bg-muted text-muted-foreground ring-1 ring-border",
                iconClassName: "",
                icon: Clock3,
              };

  const StatusIcon = statusMeta.icon;
  const successFileCount = publishResult?.file_count ?? 0;
  const statusFact =
    publishVisualState === "success" && successFileCount > 0
      ? `${successFileCount} ${appT.fileCountUnit || "个文件"}`
      : null;
  const failureMessage =
    publishVisualState === "failed" ? publishResult?.error?.trim() : null;

  // 已有执行结果（success/failed/cancelled）时日志默认收起，让结果摘要成为焦点；
  // idle/running 时保持展开，用户正在看实时日志。
  const logCollapsible = publishResult != null;
  const logEffectiveExpanded = logExpanded || !logCollapsible;
  const logLineCount = outputLog ? outputLog.split("\n").length : 0;
  const logFallbackText = isRefreshing
    ? appT.refreshingPublishCard || "正在刷新发布信息..."
    : appT.noOutput || "无输出";
  const logDisplayText = outputLog || publishResult?.error || logFallbackText;

  // 成功态动作行：主操作=打开输出目录，次操作=重新发布。
  // 其他态保持原有执行/取消结构不变（测试依赖其 className）。
  const isSuccessState = publishVisualState === "success";
  const canOpenOutputDir =
    isSuccessState && !!publishResult?.output_dir?.trim();
  const publishWarnings =
    publishResult?.warnings?.filter((w) => w.trim().length > 0) ?? [];

  return (
    <Card
      aria-busy={isRefreshing}
      className="relative flex h-full min-h-[24rem] w-full min-w-0 max-w-full flex-col overflow-hidden"
    >
      <CardHeader className="pb-3">
        <CardTitle headingLevel="h2" className="flex items-center gap-2 text-heading-20">
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
                    publishActions.startDisabled || publishActions.isPublishing
                  }
                >
                  {publishActions.isPublishing ? (
                    <>
                      <span className="inline-block animate-spin mr-2">
                        <Loader2 className="size-5" />
                      </span>
                      {publishActions.publishingLabel || "发布中..."}
                    </>
                  ) : (
                    <>
                      <Play className="size-5 mr-2" />
                      {publishActions.startLabel || "执行发布"}
                    </>
                  )}
                </Button>
                {publishActions.isPublishing && (
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    className="w-full border-destructive/30 bg-destructive/5 text-destructive hover:bg-destructive/10 hover:text-destructive disabled:bg-destructive/5 disabled:text-destructive disabled:opacity-70 sm:w-auto sm:min-w-32"
                    onClick={publishActions.onCancelPublish}
                    disabled={publishActions.isCancellingPublish}
                  >
                    {publishActions.isCancellingPublish ? (
                      <>
                        <span className="inline-block animate-spin mr-2">
                          <Loader2 className="size-4" />
                        </span>
                        {publishActions.cancellingLabel || "取消中..."}
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
              "block w-full rounded-lg border p-4",
              statusMeta.panelClassName
            )}
          >
            <div className="flex min-w-0 items-start gap-3">
              <span
                className={cn(
                  "flex size-10 flex-shrink-0 items-center justify-center rounded-md",
                  statusMeta.iconWrapClassName
                )}
              >
                <span className={cn("inline-block", statusMeta.iconClassName)}>
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
                      "inline-flex min-h-6 items-center gap-2 rounded-full border px-2.5 py-0.5 text-label-12 font-semibold",
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
              置于 <output> 之外，确保 publish-status-panel 内仅含状态图标。 */}
          {canOpenOutputDir && (
            <button
              type="button"
              className="group flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition-colors duration-150 ease-geist hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-70"
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
                <span className="text-label-12 font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                  {appT.outputDirectoryLabel || "输出目录"}
                </span>
                <span className="truncate font-mono text-label-12 text-muted-foreground transition-colors duration-150 ease-geist group-hover:text-foreground">
                  {publishResult?.output_dir}
                </span>
              </span>
              <ArrowUpRight className="size-4 flex-shrink-0 text-muted-foreground transition-colors duration-150 ease-geist group-hover:text-interactive" />
            </button>
          )}

          {failureMessage ? (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-copy-14 text-destructive">
              <div className="text-label-12 font-semibold uppercase tracking-[0.15em] text-destructive">
                {appT.statusFailed || "失败"}
              </div>
              <p className="mt-1 break-words">{failureMessage}</p>
            </div>
          ) : null}

          {/* 发布结果警告摘要：成功但有 warning 时显示，可折叠展开列表 */}
          {publishWarnings.length > 0 && (
            <div className="rounded-lg border border-warning/20 bg-warning/5">
              <button
                type="button"
                onClick={() => setWarningExpanded((v) => !v)}
                aria-expanded={warningExpanded}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors duration-150 ease-geist hover:bg-warning/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <AlertTriangle className="size-4 flex-shrink-0 text-warning" />
                <span className="text-label-12 font-semibold text-warning">
                  {publishWarnings.length} {appT.publishWarningsLabel || "个警告"}
                </span>
                <ChevronDown
                  className={cn(
                    "ml-auto size-3.5 text-warning/70 transition-transform duration-150 ease-geist",
                    warningExpanded && "rotate-180"
                  )}
                />
              </button>
              {warningExpanded && (
                <ul className="max-h-48 overflow-auto border-t border-warning/15 px-4 py-2 text-label-12 text-warning/90">
                  {publishWarnings.map((warning, idx) => (
                    <li
                      key={idx}
                      className="break-all border-b border-warning/10 py-1.5 last:border-b-0"
                    >
                      {warning}
                    </li>
                  ))}
                </ul>
              )}
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
              className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-label-12 font-medium text-muted-foreground transition-colors duration-150 ease-geist hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <Terminal className="size-3.5" />
              <span>{appT.publishLogTitle || "发布日志"}</span>
              <span className="text-muted-foreground/70">
                · {logLineCount > 0 ? `${logLineCount} 行` : (appT.publishLogEmpty || "暂无日志")}
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
              "min-w-0 flex-1 overflow-auto rounded-lg bg-[hsl(var(--terminal-bg))] p-4 font-mono text-label-12 text-[hsl(var(--terminal-fg))]",
              // 无结果时（idle/running）无折叠头，直接撑开；有结果时按折叠态控制
              logCollapsible && !logEffectiveExpanded && "hidden flex-1",
              !logCollapsible && "min-h-[16rem]"
            )}
          >
            <pre className="min-w-0 whitespace-pre-wrap break-all [overflow-wrap:anywhere]">
              {logDisplayText}
            </pre>
          </div>
        </div>
      </CardContent>
      {isRefreshing ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/80">
          <div className="flex items-center gap-2 rounded-full bg-card border border-border px-4 py-2 text-label-14 text-foreground">
            <span className="inline-block animate-spin text-interactive">
              <Loader2 className="size-4" />
            </span>
            <span>{appT.refreshingPublishCard || "正在刷新发布信息..."}</span>
          </div>
        </div>
      ) : null}
    </Card>
  );
});
