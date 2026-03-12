import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Copy } from "lucide-react";
import type { FailureGroup } from "@/lib/failureGroups";

interface FailureGroupsCardProps {
  failureGroups: FailureGroup[];
  selectedFailureGroupKey: string | null;
  failureT: Record<string, string | undefined>;
  isPublishing: boolean;
  onSelectFailureGroup: (key: string) => void;
  onCopyGroupSignature: (group: FailureGroup) => Promise<void>;
  onOpenSnapshotFromRecord: (record: FailureGroup["latestRecord"]) => Promise<void>;
  onRerunFromHistory: (record: FailureGroup["latestRecord"]) => Promise<void>;
}

export function FailureGroupsCard({
  failureGroups,
  selectedFailureGroupKey,
  failureT,
  isPublishing,
  onSelectFailureGroup,
  onCopyGroupSignature,
  onOpenSnapshotFromRecord,
  onRerunFromHistory,
}: FailureGroupsCardProps) {
  if (failureGroups.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">{failureT.groupTitle || "失败诊断聚合"}</CardTitle>
        <CardDescription>
          {failureT.groupDescription || "相同失败签名自动归并，支持分组钻取与快速复制"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {failureGroups.slice(0, 6).map((group) => {
          const isSelected = group.key === selectedFailureGroupKey;

          return (
            <div
              key={group.key}
              className="rounded-xl border border-[var(--glass-border-subtle)] px-3 py-2 text-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{group.providerId}</span>
                <span className="text-xs text-muted-foreground">
                  {(failureT.recentCount || "最近 {{count}} 次").replace(
                    "{{count}}",
                    String(group.count)
                  )}
                </span>
              </div>
              <div className="mt-1 rounded-lg bg-[var(--glass-code-bg)] px-2 py-1 font-mono text-xs break-all">
                {group.signature}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {(failureT.latestTime || "最新时间")}: {new Date(group.latestRecord.finishedAt).toLocaleString()}
              </div>
              {group.latestRecord.error && (
                <div className="text-xs text-muted-foreground break-all">
                  {(failureT.latestError || "最新错误")}: {group.latestRecord.error}
                </div>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={isSelected ? "default" : "outline"}
                  onClick={() => onSelectFailureGroup(group.key)}
                >
                  {isSelected ? failureT.selected || "已选中" : failureT.viewDetails || "查看详情"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void onCopyGroupSignature(group)}
                >
                  <Copy className="mr-1 h-3 w-3" />
                  {failureT.copySignature || "复制签名"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void onOpenSnapshotFromRecord(group.latestRecord)}
                  disabled={!group.latestRecord.snapshotPath && !group.latestRecord.outputDir}
                >
                  {failureT.openRepresentativeSnapshot || "打开代表快照"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => void onRerunFromHistory(group.latestRecord)}
                  disabled={isPublishing}
                >
                  {failureT.rerunRepresentative || "重跑代表记录"}
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
