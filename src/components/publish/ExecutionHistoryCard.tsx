import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import type { ExecutionRecord } from "@/lib/store";
import type {
  HistoryFilterStatus,
  HistoryFilterWindow,
} from "@/lib/historyFilterPresets";
import type { HandoffSnippetFormat } from "@/lib/handoffSnippet";

export interface ExecutionHistoryCardProps {
  scopedExecutionHistory: ExecutionRecord[];
  filteredExecutionHistory: ExecutionRecord[];
  executionHistoryLimit: number;
  historyProviderOptions: string[];
  historyFilterProvider: string;
  historyFilterStatus: HistoryFilterStatus;
  historyFilterWindow: HistoryFilterWindow;
  historyFilterKeyword: string;
  isExportingHistory: boolean;
  isPublishing: boolean;
  appT: Record<string, string | undefined>;
  historyT: Record<string, string | undefined>;
  failureT: Record<string, string | undefined>;
  onHistoryFilterProviderChange: (value: string) => void;
  onHistoryFilterStatusChange: (value: HistoryFilterStatus) => void;
  onHistoryFilterWindowChange: (value: HistoryFilterWindow) => void;
  onHistoryFilterKeywordChange: (value: string) => void;
  onExportExecutionHistory: () => Promise<void>;
  onClearFilters: () => void;
  onOpenSnapshotFromRecord: (record: ExecutionRecord) => Promise<void>;
  onRerunFromHistory: (record: ExecutionRecord) => Promise<void>;
  onCopyHandoffSnippet: (
    record: ExecutionRecord,
    format: HandoffSnippetFormat
  ) => Promise<void>;
}

export function ExecutionHistoryCard({
  scopedExecutionHistory,
  filteredExecutionHistory,
  executionHistoryLimit,
  historyProviderOptions,
  historyFilterProvider,
  historyFilterStatus,
  historyFilterWindow,
  historyFilterKeyword,
  isExportingHistory,
  isPublishing,
  appT,
  historyT,
  failureT,
  onHistoryFilterProviderChange,
  onHistoryFilterStatusChange,
  onHistoryFilterWindowChange,
  onHistoryFilterKeywordChange,
  onExportExecutionHistory,
  onClearFilters,
  onOpenSnapshotFromRecord,
  onRerunFromHistory,
  onCopyHandoffSnippet,
}: ExecutionHistoryCardProps) {
  if (scopedExecutionHistory.length === 0) {
    return null;
  }

  const getFailureReason = (record: ExecutionRecord) => {
    if (record.success || record.cancelled) {
      return null;
    }

    return record.error?.trim() || record.failureSignature?.trim() || null;
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">{historyT.title || "最近执行历史"}</CardTitle>
        <CardDescription>
          {(historyT.description || "本地保留最近 {{count}} 条发布记录").replace(
            "{{count}}",
            String(executionHistoryLimit)
          )}
          {filteredExecutionHistory.length !== scopedExecutionHistory.length
            ? ` · ${(historyT.currentFilter || "当前筛选")} ${filteredExecutionHistory.length}/${scopedExecutionHistory.length}`
            : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 md:grid-cols-4">
          <Select
            value={historyFilterProvider}
            onValueChange={onHistoryFilterProviderChange}
          >
            <SelectTrigger className="h-8">
              <SelectValue placeholder={historyT.filterProvider || "筛选 Provider"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{historyT.allProviders || "全部 Provider"}</SelectItem>
              {historyProviderOptions.map((providerId) => (
                <SelectItem key={providerId} value={providerId}>
                  {providerId}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={historyFilterStatus}
            onValueChange={(value) =>
              onHistoryFilterStatusChange(value as HistoryFilterStatus)
            }
          >
            <SelectTrigger className="h-8">
              <SelectValue placeholder={historyT.filterStatus || "筛选状态"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{historyT.allStatuses || "全部状态"}</SelectItem>
              <SelectItem value="success">{appT.statusSuccess || "成功"}</SelectItem>
              <SelectItem value="failed">{appT.statusFailed || "失败"}</SelectItem>
              <SelectItem value="cancelled">{appT.statusCancelled || "已取消"}</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={historyFilterWindow}
            onValueChange={(value) =>
              onHistoryFilterWindowChange(value as HistoryFilterWindow)
            }
          >
            <SelectTrigger className="h-8">
              <SelectValue placeholder={historyT.timeWindow || "时间窗口"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{historyT.allTime || "全部时间"}</SelectItem>
              <SelectItem value="24h">{historyT.last24Hours || "最近 24 小时"}</SelectItem>
              <SelectItem value="7d">{historyT.last7Days || "最近 7 天"}</SelectItem>
              <SelectItem value="30d">{historyT.last30Days || "最近 30 天"}</SelectItem>
            </SelectContent>
          </Select>
          <Input
            className="h-8"
            value={historyFilterKeyword}
            onChange={(e) => onHistoryFilterKeywordChange(e.target.value)}
            placeholder={historyT.keywordPlaceholder || "关键词（签名/错误/命令）"}
          />
        </div>

        <div className="flex items-center justify-between border-t border-[var(--glass-divider)] pt-3">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => void onExportExecutionHistory()}
              disabled={isExportingHistory || filteredExecutionHistory.length === 0}
            >
              {isExportingHistory ? (
                <>
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  {appT.exporting || "导出中..."}
                </>
              ) : (
                historyT.exportHistory || "导出历史"
              )}
            </Button>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onClearFilters}
            disabled={
              historyFilterProvider === "all" &&
              historyFilterStatus === "all" &&
              historyFilterWindow === "all" &&
              historyFilterKeyword.length === 0
            }
          >
            {historyT.clearFilters || "清空筛选"}
          </Button>
        </div>

        {filteredExecutionHistory.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--glass-border-subtle)] px-3 py-4 text-sm text-muted-foreground">
            {historyT.noRecords || "当前筛选条件下无执行记录"}
          </div>
        ) : (
          filteredExecutionHistory.slice(0, 6).map((record) => {
            const failureReason = getFailureReason(record);

            return (
              <div
                key={record.id}
                className="rounded-xl border border-[var(--glass-border-subtle)] px-3 py-2 text-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{record.providerId}</span>
                  <span
                    className={`text-xs rounded-md px-1.5 py-0.5 ${
                      record.success
                        ? "status-success"
                        : record.cancelled
                          ? "status-cancelled"
                          : "status-failed"
                    }`}
                  >
                    {record.success
                      ? appT.statusSuccess || "成功"
                      : record.cancelled
                        ? appT.statusCancelled || "已取消"
                        : appT.statusFailed || "失败"}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground truncate">{record.projectPath}</div>
                <div className="text-xs text-muted-foreground">
                  {(historyT.completedAt || "完成时间")}: {new Date(record.finishedAt).toLocaleString()}
                </div>
                {failureReason && (
                  <div className="mt-2 rounded-lg border border-destructive/20 bg-destructive/5 px-2.5 py-2 text-xs text-destructive">
                    <span className="font-medium">
                      {historyT.failureReason || "失败原因"}:
                    </span>{" "}
                    <span className="break-words">{failureReason}</span>
                  </div>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void onOpenSnapshotFromRecord(record)}
                    disabled={!record.snapshotPath && !record.outputDir}
                  >
                    {failureT.openSnapshot || "打开快照"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => void onRerunFromHistory(record)}
                    disabled={isPublishing}
                  >
                    {historyT.rerun || "重新执行"}
                  </Button>
                  {record.success && (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void onCopyHandoffSnippet(record, "shell")}
                      >
                        {historyT.copyShellSnippet || "复制 Shell 片段"}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
