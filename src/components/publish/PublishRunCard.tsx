import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ArrowUpRight, FolderOpen, Loader2, Play, Square, Terminal } from "lucide-react";
import type { PublishResult } from "@/hooks/usePublishRunner";
import { openOutputDirectory } from "@/lib/store";

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
}

export function PublishRunCard({
  outputLog,
  publishResult,
  appT,
  publishActions,
}: PublishRunCardProps) {
  const [isOpeningOutputDir, setIsOpeningOutputDir] = useState(false);

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

  if (!outputLog && !publishResult && !publishActions) {
    return null;
  }

  return (
    <Card className="flex h-full min-h-[28rem] w-full flex-col lg:min-h-[calc(100vh-11rem)]">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Terminal className="h-5 w-5" />
          {appT.outputLogTitle || "执行发布"}
          {publishResult && (
            <span
              className={`ml-2 text-sm font-normal ${
                publishResult.success
                  ? "text-success"
                  : publishResult.cancelled
                    ? "text-warning"
                    : "text-destructive"
              }`}
            >
              {publishResult.success
                ? appT.statusSuccess || "成功"
                : publishResult.cancelled
                  ? appT.statusCancelled || "已取消"
                  : appT.statusFailed || "失败"}
            </span>
          )}
        </CardTitle>
        {publishResult?.success && publishResult.output_dir && (
          <button
            type="button"
            className="glass-surface group mt-1 w-full rounded-2xl border border-[var(--glass-border-subtle)] p-3 text-left transition-all duration-300 hover:-translate-y-0.5 hover:bg-[var(--glass-bg-hover)] hover:shadow-[var(--glass-shadow-lg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-70"
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
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col space-y-4">
        {publishActions && (
          <div className="space-y-3">
            {publishActions.publishCommand && (
              <div className="rounded-xl border border-[var(--glass-border-subtle)] bg-[var(--glass-input-bg)] p-3">
                <div className="mb-2 text-xs text-muted-foreground">
                  {publishActions.publishCommandLabel || "将执行的命令:"}
                </div>
                <code className="text-xs font-mono break-all">
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
        <div className="min-h-[20rem] flex-1 overflow-auto rounded-lg bg-gray-950 p-4 font-mono text-xs text-gray-100">
          <pre className="whitespace-pre-wrap">
            {outputLog || publishResult?.error || appT.noOutput || "无输出"}
          </pre>
        </div>
      </CardContent>
    </Card>
  );
}
