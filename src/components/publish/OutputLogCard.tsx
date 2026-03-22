import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Loader2, Play, Square, Terminal } from "lucide-react";
import type { PublishResult } from "@/hooks/usePublishExecution";

export interface OutputLogCardPublishControls {
  publishCommand?: string | null;
  publishCommandLabel?: string;
  executeLabel?: string;
  publishingLabel?: string;
  cancelLabel?: string;
  cancellingLabel?: string;
  isPublishing: boolean;
  isCancellingPublish: boolean;
  executeDisabled: boolean;
  onExecutePublish: () => void;
  onCancelPublish: () => void;
}

export interface OutputLogCardProps {
  outputLog: string;
  publishResult: PublishResult | null;
  appT: Record<string, string | undefined>;
  publishControls: OutputLogCardPublishControls | null;
}

export function OutputLogCard({
  outputLog,
  publishResult,
  appT,
  publishControls,
}: OutputLogCardProps) {
  if (!outputLog && !publishResult && !publishControls) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Terminal className="h-5 w-5" />
          {appT.outputLogTitle || "输出日志"}
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
          <>
            <CardDescription>
              {(appT.outputDirectoryLabel || "输出目录")}: {publishResult.output_dir} (
              {publishResult.file_count} {appT.fileCountUnit || "个文件"})
            </CardDescription>
          </>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {publishControls && (
          <div className="space-y-3">
            {publishControls.publishCommand && (
              <div className="rounded-xl border border-[var(--glass-border-subtle)] bg-[var(--glass-input-bg)] p-3">
                <div className="mb-2 text-xs text-muted-foreground">
                  {publishControls.publishCommandLabel || "将执行的命令:"}
                </div>
                <code className="text-xs font-mono break-all">
                  {publishControls.publishCommand}
                </code>
              </div>
            )}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                className="w-full sm:flex-1"
                size="lg"
                onClick={publishControls.onExecutePublish}
                disabled={
                  publishControls.executeDisabled || publishControls.isPublishing
                }
              >
                {publishControls.isPublishing ? (
                  <>
                    <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                    {publishControls.publishingLabel || "发布中..."}
                  </>
                ) : (
                  <>
                    <Play className="h-5 w-5 mr-2" />
                    {publishControls.executeLabel || "执行发布"}
                  </>
                )}
              </Button>
              {publishControls.isPublishing && (
                <Button
                  type="button"
                  variant="destructive"
                  className="w-full sm:w-auto"
                  onClick={publishControls.onCancelPublish}
                  disabled={publishControls.isCancellingPublish}
                >
                  {publishControls.isCancellingPublish ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {publishControls.cancellingLabel || "取消中..."}
                    </>
                  ) : (
                    <>
                      <Square className="h-4 w-4 mr-2" />
                      {publishControls.cancelLabel || "取消发布"}
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        )}
        <div className="bg-gray-950 text-gray-100 p-4 rounded-lg font-mono text-xs max-h-80 overflow-auto">
          <pre className="whitespace-pre-wrap">
            {outputLog || publishResult?.error || appT.noOutput || "无输出"}
          </pre>
        </div>
      </CardContent>
    </Card>
  );
}
