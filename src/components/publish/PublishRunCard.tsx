import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  FolderOpen,
  Loader2,
  Play,
  Square,
  Terminal,
  XCircle,
} from "lucide-react";
import type { PublishResult } from "@/lib/publishRuntime";
import { openOutputDirectory } from "@/lib/store";
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

export function PublishRunCard({
  outputLog: currentOutputLog,
  publishResult: currentPublishResult,
  appT,
  publishActions: currentPublishActions,
  isRefreshing = false,
}: PublishRunCardProps) {
  const [isOpeningOutputDir, setIsOpeningOutputDir] = useState(false);
  const [displaySnapshot, setDisplaySnapshot] = useState<{
    outputLog: string;
    publishResult: PublishResult | null;
    publishActions: PublishRunCardActions | null;
  }>({
    outputLog: currentOutputLog,
    publishResult: currentPublishResult,
    publishActions: currentPublishActions,
  });

  useEffect(() => {
    if (isRefreshing) {
      return;
    }

    setDisplaySnapshot({
      outputLog: currentOutputLog,
      publishResult: currentPublishResult,
      publishActions: currentPublishActions,
    });
  }, [
    currentOutputLog,
    currentPublishActions,
    currentPublishResult,
    isRefreshing,
  ]);

  const outputLog = isRefreshing
    ? displaySnapshot.outputLog
    : currentOutputLog;
  const publishResult = isRefreshing
    ? displaySnapshot.publishResult
    : currentPublishResult;
  const publishActions = isRefreshing
    ? displaySnapshot.publishActions
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
            "border-primary/15 bg-primary/10 text-primary shadow-[0_10px_30px_hsl(var(--primary)/0.12)]",
          panelClassName:
            "border-primary/15 bg-[linear-gradient(145deg,hsl(var(--primary)/0.1),transparent_78%)]",
          iconWrapClassName:
            "bg-primary/12 text-primary shadow-[0_0_0_1px_hsl(var(--primary)/0.08)]",
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
              "status-success shadow-[0_10px_30px_hsl(var(--success)/0.12)]",
            panelClassName:
              "border-success/15 bg-[linear-gradient(145deg,hsl(var(--success)/0.11),transparent_78%)]",
            iconWrapClassName:
              "bg-success/12 text-success shadow-[0_0_0_1px_hsl(var(--success)/0.08)]",
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
                "status-cancelled shadow-[0_10px_30px_hsl(var(--warning)/0.12)]",
              panelClassName:
                "border-warning/15 bg-[linear-gradient(145deg,hsl(var(--warning)/0.13),transparent_78%)]",
              iconWrapClassName:
                "bg-warning/12 text-warning shadow-[0_0_0_1px_hsl(var(--warning)/0.08)]",
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
                  "status-failed shadow-[0_10px_30px_hsl(var(--destructive)/0.12)]",
                panelClassName:
                  "border-destructive/15 bg-[linear-gradient(145deg,hsl(var(--destructive)/0.1),transparent_78%)]",
                iconWrapClassName:
                  "bg-destructive/12 text-destructive shadow-[0_0_0_1px_hsl(var(--destructive)/0.08)]",
                iconClassName: "",
                icon: XCircle,
              }
            : {
                label: appT.publishStatusIdle || "待执行",
                description:
                  appT.publishStatusIdleDetail ||
                  "命令与参数已准备完成，可以开始本次发布。",
                badgeClassName:
                  "border-[var(--glass-border-subtle)] bg-[var(--glass-bg)] text-muted-foreground shadow-[0_10px_30px_rgba(15,23,42,0.06)]",
                panelClassName:
                  "border-[var(--glass-border-subtle)] bg-[linear-gradient(145deg,rgba(255,255,255,0.32),transparent_78%)]",
                iconWrapClassName:
                  "bg-[var(--glass-input-bg)] text-muted-foreground shadow-[0_0_0_1px_var(--glass-border-subtle)]",
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

  return (
    <Card
      aria-busy={isRefreshing}
      className="relative flex h-full min-h-[28rem] w-full min-w-0 max-w-full flex-col overflow-hidden lg:min-h-[calc(100vh-11rem)]"
    >
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Terminal className="h-5 w-5" />
          {appT.outputLogTitle || "执行发布"}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-0 min-w-0 flex-1 flex-col space-y-4">
        {publishActions && (
          <div className="min-w-0 space-y-3">
            {publishActions.publishCommand && (
              <div className="min-w-0 rounded-xl border border-[var(--glass-border-subtle)] bg-[var(--glass-input-bg)] p-3">
                <div className="mb-2 text-xs text-muted-foreground">
                  {publishActions.publishCommandLabel || "将执行的命令:"}
                </div>
                <code className="block text-xs font-mono break-all [overflow-wrap:anywhere]">
                  {publishActions.publishCommand}
                </code>
              </div>
            )}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                className="w-full sm:flex-1"
                size="lg"
                onClick={publishActions.onStartPublish}
                disabled={
                  publishActions.startDisabled || publishActions.isPublishing
                }
              >
                {publishActions.isPublishing ? (
                  <>
                    <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                    {publishActions.publishingLabel || "发布中..."}
                  </>
                ) : (
                  <>
                    <Play className="h-5 w-5 mr-2" />
                    {publishActions.startLabel || "执行发布"}
                  </>
                )}
              </Button>
              {publishActions.isPublishing && (
                <Button
                  type="button"
                  variant="destructive"
                  className="w-full sm:w-auto"
                  onClick={publishActions.onCancelPublish}
                  disabled={publishActions.isCancellingPublish}
                >
                  {publishActions.isCancellingPublish ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {publishActions.cancellingLabel || "取消中..."}
                    </>
                  ) : (
                    <>
                      <Square className="h-4 w-4 mr-2" />
                      {publishActions.cancelLabel || "取消发布"}
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        )}
        <div className="min-w-0 space-y-3">
          <div
            data-testid="publish-status-panel"
            className={cn(
              "glass-surface rounded-2xl border p-4",
              statusMeta.panelClassName
            )}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <span
                  className={cn(
                    "mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl",
                    statusMeta.iconWrapClassName
                  )}
                >
                  <StatusIcon className={cn("h-5 w-5", statusMeta.iconClassName)} />
                </span>
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
                    {appT.publishStatusLabel || "发布状态"}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold backdrop-blur-md",
                        statusMeta.badgeClassName
                      )}
                    >
                      {statusMeta.label}
                    </span>
                    {statusFact ? (
                      <span className="inline-flex items-center rounded-full border border-[var(--glass-border-subtle)] bg-background/60 px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur-md">
                        {statusFact}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground/85">
                    {statusMeta.description}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {failureMessage ? (
            <div className="rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-destructive/70">
                {appT.statusFailed || "失败"}
              </div>
              <p className="mt-1 break-words leading-6">{failureMessage}</p>
            </div>
          ) : null}

          {publishVisualState === "success" && publishResult?.output_dir && (
            <button
              type="button"
              className="glass-surface group w-full rounded-2xl border border-[var(--glass-border-subtle)] p-3 text-left transition-all duration-300 hover:-translate-y-0.5 hover:bg-[var(--glass-bg-hover)] hover:shadow-[var(--glass-shadow-lg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-70"
              onClick={handleOpenOutputDir}
              disabled={isOpeningOutputDir}
            >
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-[0_0_0_1px_hsl(var(--primary)/0.08)]">
                  {isOpeningOutputDir ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <FolderOpen className="h-4 w-4" />
                  )}
                </span>
                <span className="min-w-0 flex flex-1 items-center gap-3 overflow-hidden">
                  <span className="flex-shrink-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
                    {appT.outputDirectoryLabel || "输出目录"}
                  </span>
                  <span className="truncate font-mono text-xs text-muted-foreground/80 transition-all duration-300 group-hover:font-semibold group-hover:text-foreground">
                    {publishResult.output_dir}
                  </span>
                </span>
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl text-muted-foreground/65 transition-all duration-300 group-hover:bg-primary/10 group-hover:text-primary">
                  <ArrowUpRight className="h-4 w-4" />
                </span>
              </div>
            </button>
          )}
        </div>
        <div className="min-h-[20rem] min-w-0 flex-1 overflow-auto rounded-lg bg-gray-950 p-4 font-mono text-xs text-gray-100">
          <pre className="min-w-0 whitespace-pre-wrap break-all [overflow-wrap:anywhere]">
            {outputLog ||
              publishResult?.error ||
              (isRefreshing
                ? appT.refreshingPublishCard || "正在刷新发布信息..."
                : appT.noOutput || "无输出")}
          </pre>
        </div>
      </CardContent>
      {isRefreshing ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/48 backdrop-blur-[2px]">
          <div className="glass-surface flex items-center gap-2 rounded-full px-4 py-2 text-sm text-foreground shadow-[var(--glass-shadow)]">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span>{appT.refreshingPublishCard || "正在刷新发布信息..."}</span>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
