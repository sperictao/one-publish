import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Copy, Loader2 } from "lucide-react";
import type { FailureGroup } from "@/lib/failureGroups";
import type { ExecutionRecord } from "@/lib/store";
import type { IssueDraftTemplate } from "@/lib/issueDraft";

export interface FailureGroupDetailCardProps {
  selectedFailureGroup: FailureGroup | null;
  representativeFailureRecord: ExecutionRecord | null;
  issueDraftTemplate: IssueDraftTemplate;
  issueDraftSections: {
    impact: boolean;
    workaround: boolean;
    owner: boolean;
  };
  failureT: Record<string, string | undefined>;
  appT: Record<string, string | undefined>;
  isExportingFailureBundle: boolean;
  isPublishing: boolean;
  onIssueDraftTemplateChange: (value: IssueDraftTemplate) => void;
  onToggleIssueDraftSection: (key: "impact" | "workaround" | "owner") => void;
  onCopyGroupSignature: (group: FailureGroup) => Promise<void>;
  onCopyRecordCommand: (record: ExecutionRecord) => Promise<void>;
  onCopyFailureIssueDraft: (group: FailureGroup) => Promise<void>;
  onExportFailureGroupBundle: () => void;
  onOpenSnapshotFromRecord: (record: ExecutionRecord) => Promise<void>;
  onRerunFromHistory: (record: ExecutionRecord) => Promise<void>;
}

export function FailureGroupDetailCard({
  selectedFailureGroup,
  representativeFailureRecord,
  issueDraftTemplate,
  issueDraftSections,
  failureT,
  appT,
  isExportingFailureBundle,
  isPublishing,
  onIssueDraftTemplateChange,
  onToggleIssueDraftSection,
  onCopyGroupSignature,
  onCopyRecordCommand,
  onCopyFailureIssueDraft,
  onExportFailureGroupBundle,
  onOpenSnapshotFromRecord,
  onRerunFromHistory,
}: FailureGroupDetailCardProps) {
  if (!selectedFailureGroup) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">{failureT.detailTitle || "失败组详情"}</CardTitle>
        <CardDescription>
          {(failureT.detailDescription || "{{provider}} · 最近 {{count}} 次失败（按完成时间倒序）")
            .replace("{{provider}}", selectedFailureGroup.providerId)
            .replace("{{count}}", String(selectedFailureGroup.count))}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-lg bg-[var(--glass-code-bg)] px-2 py-1 font-mono text-xs break-all">
          {selectedFailureGroup.signature}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={issueDraftTemplate}
            onValueChange={(value) =>
              onIssueDraftTemplateChange(value as IssueDraftTemplate)
            }
          >
            <SelectTrigger className="h-8 w-[180px]">
              <SelectValue placeholder={failureT.issueTemplate || "Issue 模板"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="bug">{failureT.bugTemplate || "Bug 模板"}</SelectItem>
              <SelectItem value="incident">{failureT.incidentTemplate || "Incident 模板"}</SelectItem>
              <SelectItem value="postmortem">{failureT.postmortemTemplate || "Postmortem 模板"}</SelectItem>
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="sm"
            variant={issueDraftSections.impact ? "default" : "outline"}
            onClick={() => onToggleIssueDraftSection("impact")}
          >
            Impact
          </Button>
          <Button
            type="button"
            size="sm"
            variant={issueDraftSections.workaround ? "default" : "outline"}
            onClick={() => onToggleIssueDraftSection("workaround")}
          >
            Workaround
          </Button>
          <Button
            type="button"
            size="sm"
            variant={issueDraftSections.owner ? "default" : "outline"}
            onClick={() => onToggleIssueDraftSection("owner")}
          >
            Owner
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void onCopyGroupSignature(selectedFailureGroup)}
          >
            <Copy className="mr-1 h-3 w-3" />
            {failureT.copySignature || "复制签名"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              representativeFailureRecord
                ? void onCopyRecordCommand(representativeFailureRecord)
                : undefined
            }
            disabled={!representativeFailureRecord?.commandLine}
          >
            <Copy className="mr-1 h-3 w-3" />
            {failureT.copyRepresentativeCommand || "复制代表命令"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void onCopyFailureIssueDraft(selectedFailureGroup)}
          >
            {failureT.copyIssueDraft || "复制 Issue 草稿"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={onExportFailureGroupBundle}
            disabled={isExportingFailureBundle}
          >
            {isExportingFailureBundle ? (
              <>
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                {appT.exporting || "导出中..."}
              </>
            ) : (
              failureT.exportBundle || "导出诊断包"
            )}
          </Button>
        </div>
        {selectedFailureGroup.records.slice(0, 6).map((record, index) => (
          <div
            key={record.id}
            className="rounded-xl border border-[var(--glass-border-subtle)] px-3 py-2 text-sm"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">
                {index === 0
                  ? failureT.latestFailureRecord || "最新失败记录"
                  : (failureT.historyFailureRecord || "历史失败记录 #{{index}}")
                      .replace("{{index}}", String(index + 1))}
              </span>
              <span className="text-xs text-muted-foreground">
                {new Date(record.finishedAt).toLocaleString()}
              </span>
            </div>
            <div className="text-xs text-muted-foreground truncate">{record.projectPath}</div>
            <div className="mt-1 rounded-lg bg-[var(--glass-code-bg)] px-2 py-1 font-mono text-xs break-all">
              {record.commandLine || failureT.noCommandLine || "(无命令行记录)"}
            </div>
            {record.error && (
              <div className="mt-1 text-xs text-muted-foreground break-all">
                {(failureT.errorLabel || "错误")}: {record.error}
              </div>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void onCopyRecordCommand(record)}
                disabled={!record.commandLine}
              >
                <Copy className="mr-1 h-3 w-3" />
                {failureT.copyCommand || "复制命令"}
              </Button>
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
                {failureT.rerunRecord || "重跑记录"}
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
