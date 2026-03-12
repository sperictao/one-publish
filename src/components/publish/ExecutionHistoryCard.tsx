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
import { Switch } from "@/components/ui/switch";
import { Loader2 } from "lucide-react";
import type { ExecutionRecord } from "@/lib/store";
import type {
  DailyTriagePreset,
  HistoryExportFormat,
  HistoryFilterPreset,
  HistoryFilterStatus,
  HistoryFilterWindow,
} from "@/lib/historyFilterPresets";
import type { HandoffSnippetFormat } from "@/lib/handoffSnippet";

interface ExecutionHistoryCardProps {
  scopedExecutionHistory: ExecutionRecord[];
  filteredExecutionHistory: ExecutionRecord[];
  executionHistoryLimit: number;
  historyProviderOptions: string[];
  historyFilterProvider: string;
  historyFilterStatus: HistoryFilterStatus;
  historyFilterWindow: HistoryFilterWindow;
  historyFilterKeyword: string;
  selectedHistoryPresetId: string;
  historyFilterPresets: HistoryFilterPreset[];
  dailyTriagePreset: DailyTriagePreset;
  dailyTriageRecords: ExecutionRecord[];
  isExportingHistory: boolean;
  isExportingDiagnosticsIndex: boolean;
  isPublishing: boolean;
  appT: Record<string, string | undefined>;
  historyT: Record<string, string | undefined>;
  failureT: Record<string, string | undefined>;
  onHistoryFilterProviderChange: (value: string) => void;
  onHistoryFilterStatusChange: (value: HistoryFilterStatus) => void;
  onHistoryFilterWindowChange: (value: HistoryFilterWindow) => void;
  onHistoryFilterKeywordChange: (value: string) => void;
  onApplyHistoryPreset: (value: string) => void;
  onSaveCurrentHistoryPreset: () => void;
  onDeleteSelectedHistoryPreset: () => void;
  onDailyTriagePresetChange: (updater: (prev: DailyTriagePreset) => DailyTriagePreset) => void;
  onResetDailyTriagePreset: () => void;
  onExportExecutionHistory: () => Promise<void>;
  onExportDailyTriageReport: () => void;
  onExportDiagnosticsIndex: () => void;
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
  selectedHistoryPresetId,
  historyFilterPresets,
  dailyTriagePreset,
  dailyTriageRecords,
  isExportingHistory,
  isExportingDiagnosticsIndex,
  isPublishing,
  appT,
  historyT,
  failureT,
  onHistoryFilterProviderChange,
  onHistoryFilterStatusChange,
  onHistoryFilterWindowChange,
  onHistoryFilterKeywordChange,
  onApplyHistoryPreset,
  onSaveCurrentHistoryPreset,
  onDeleteSelectedHistoryPreset,
  onDailyTriagePresetChange,
  onResetDailyTriagePreset,
  onExportExecutionHistory,
  onExportDailyTriageReport,
  onExportDiagnosticsIndex,
  onClearFilters,
  onOpenSnapshotFromRecord,
  onRerunFromHistory,
  onCopyHandoffSnippet,
}: ExecutionHistoryCardProps) {
  if (scopedExecutionHistory.length === 0) {
    return null;
  }

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

        <div className="flex flex-wrap items-center gap-2">
          <Select value={selectedHistoryPresetId} onValueChange={onApplyHistoryPreset}>
            <SelectTrigger className="h-8 w-[220px]">
              <SelectValue placeholder={historyT.selectPreset || "选择筛选预设"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{historyT.noPreset || "(不使用预设)"}</SelectItem>
              {historyFilterPresets.map((preset) => (
                <SelectItem key={preset.id} value={preset.id}>
                  {preset.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" size="sm" variant="outline" onClick={onSaveCurrentHistoryPreset}>
            {historyT.saveAsPreset || "保存为预设"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onDeleteSelectedHistoryPreset}
            disabled={selectedHistoryPresetId === "none"}
          >
            {historyT.deletePreset || "删除预设"}
          </Button>
        </div>

        <details className="group rounded-xl border border-[var(--glass-border-subtle)] bg-[var(--glass-input-bg)]">
          <summary className="flex cursor-pointer items-center justify-between p-3 text-sm font-medium select-none">
            <span>{historyT.dailyPresetTitle || "每日排障预设"}</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{historyT.enabled || "启用"}</span>
              <Switch
                checked={dailyTriagePreset.enabled}
                onCheckedChange={(checked) =>
                  onDailyTriagePresetChange((prev) => ({
                    ...prev,
                    enabled: checked,
                  }))
                }
              />
            </div>
          </summary>
          <div className="border-t border-[var(--glass-divider)] p-3 space-y-2">
            <div className="grid gap-2 md:grid-cols-5">
              <Select
                value={dailyTriagePreset.provider}
                onValueChange={(value) =>
                  onDailyTriagePresetChange((prev) => ({
                    ...prev,
                    provider: value,
                  }))
                }
              >
                <SelectTrigger className="h-8">
                  <SelectValue placeholder={historyT.provider || "Provider"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{historyT.allProviders || "全部 Provider"}</SelectItem>
                  {historyProviderOptions.map((providerId) => (
                    <SelectItem key={`triage-${providerId}`} value={providerId}>
                      {providerId}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={dailyTriagePreset.status}
                onValueChange={(value) =>
                  onDailyTriagePresetChange((prev) => ({
                    ...prev,
                    status: value as HistoryFilterStatus,
                  }))
                }
              >
                <SelectTrigger className="h-8">
                  <SelectValue placeholder={historyT.status || "状态"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{historyT.allStatuses || "全部状态"}</SelectItem>
                  <SelectItem value="success">{appT.statusSuccess || "成功"}</SelectItem>
                  <SelectItem value="failed">{appT.statusFailed || "失败"}</SelectItem>
                  <SelectItem value="cancelled">{appT.statusCancelled || "已取消"}</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={dailyTriagePreset.window}
                onValueChange={(value) =>
                  onDailyTriagePresetChange((prev) => ({
                    ...prev,
                    window: value as HistoryFilterWindow,
                  }))
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
              <Select
                value={dailyTriagePreset.format}
                onValueChange={(value) =>
                  onDailyTriagePresetChange((prev) => ({
                    ...prev,
                    format: value as HistoryExportFormat,
                  }))
                }
              >
                <SelectTrigger className="h-8">
                  <SelectValue placeholder={historyT.format || "格式"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="csv">CSV</SelectItem>
                  <SelectItem value="json">JSON</SelectItem>
                </SelectContent>
              </Select>
              <Input
                className="h-8"
                value={dailyTriagePreset.keyword}
                onChange={(event) =>
                  onDailyTriagePresetChange((prev) => ({
                    ...prev,
                    keyword: event.target.value,
                  }))
                }
                placeholder={historyT.dailyKeyword || "日报关键词（可选）"}
              />
            </div>
            <div className="text-xs text-muted-foreground">
              {(historyT.dailyPresetMatches || "当前预设命中 {{count}} 条记录").replace(
                "{{count}}",
                String(dailyTriageRecords.length)
              )}
              {dailyTriagePreset.enabled ? "" : historyT.disabled || "（已禁用）"}
            </div>
            <Button type="button" size="sm" variant="secondary" onClick={onResetDailyTriagePreset}>
              {historyT.resetDailyPreset || "恢复日报默认预设"}
            </Button>
          </div>
        </details>

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
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={onExportDailyTriageReport}
              disabled={!dailyTriagePreset.enabled || isExportingHistory}
            >
              {isExportingHistory ? (
                <>
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  {appT.exporting || "导出中..."}
                </>
              ) : (
                historyT.exportDailyReport || "一键导出日报"
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={onExportDiagnosticsIndex}
              disabled={isExportingDiagnosticsIndex}
            >
              {isExportingDiagnosticsIndex ? (
                <>
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  {historyT.generating || "生成中..."}
                </>
              ) : (
                historyT.exportDiagnosticsIndex || "导出诊断索引"
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
          filteredExecutionHistory.slice(0, 6).map((record) => (
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
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void onCopyHandoffSnippet(record, "github-actions")}
                    >
                      {historyT.copyGhaSnippet || "复制 GHA 片段"}
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
