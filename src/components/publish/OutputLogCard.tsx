import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ArtifactActions,
  type ArtifactActionState,
} from "@/components/publish/ArtifactActions";
import { ListChecks, Loader2, Terminal } from "lucide-react";
import type { PublishResult } from "@/hooks/usePublishExecution";

export interface OutputLogCardProps {
  outputLog: string;
  publishResult: PublishResult | null;
  appT: Record<string, string | undefined>;
  isExportingSnapshot: boolean;
  onExportExecutionSnapshot: () => void;
  onOpenReleaseChecklist: () => void;
  onArtifactActionStateChange: (state: ArtifactActionState) => void;
}

export function OutputLogCard({
  outputLog,
  publishResult,
  appT,
  isExportingSnapshot,
  onExportExecutionSnapshot,
  onOpenReleaseChecklist,
  onArtifactActionStateChange,
}: OutputLogCardProps) {
  if (!outputLog && !publishResult) {
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
        {publishResult && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={onExportExecutionSnapshot}
            disabled={isExportingSnapshot}
          >
            {isExportingSnapshot ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {appT.exporting || "导出中..."}
              </>
            ) : (
              appT.exportSnapshot || "导出执行快照"
            )}
          </Button>
        )}
        {publishResult?.success && publishResult.output_dir && (
          <>
            <CardDescription>
              {(appT.outputDirectoryLabel || "输出目录")}: {publishResult.output_dir} (
              {publishResult.file_count} {appT.fileCountUnit || "个文件"})
            </CardDescription>
            {publishResult.provider_id === "dotnet" && (
              <>
                <ArtifactActions
                  outputDir={publishResult.output_dir}
                  onStateChange={onArtifactActionStateChange}
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="w-fit"
                  onClick={onOpenReleaseChecklist}
                >
                  <ListChecks className="h-4 w-4 mr-1" />
                  {appT.openReleaseChecklist || "打开签名发布清单"}
                </Button>
              </>
            )}
          </>
        )}
      </CardHeader>
      <CardContent>
        <div className="bg-gray-950 text-gray-100 p-4 rounded-lg font-mono text-xs max-h-80 overflow-auto">
          <pre className="whitespace-pre-wrap">
            {outputLog || publishResult?.error || appT.noOutput || "无输出"}
          </pre>
        </div>
      </CardContent>
    </Card>
  );
}
