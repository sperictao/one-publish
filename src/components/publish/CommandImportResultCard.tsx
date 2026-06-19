import { Import } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface ImportFeedback {
  providerId: string;
  mappedKeys: string[];
  unmappedKeys: string[];
}

export interface CommandImportResultCardProps {
  activeImportFeedback: ImportFeedback;
  providerLabel: string;
  appT: Record<string, string | undefined>;
}

export function CommandImportResultCard({
  activeImportFeedback,
  providerLabel,
  appT,
}: CommandImportResultCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Import className="size-5" />
          {appT.commandImportResult || "命令导入映射结果"}
        </CardTitle>
        <CardDescription>Provider: {providerLabel}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-success">
          {(appT.mappedFieldsLabel || "已映射字段") +
            ` (${activeImportFeedback.mappedKeys.length}):`}
          {activeImportFeedback.mappedKeys.length > 0
            ? activeImportFeedback.mappedKeys.join(", ")
            : appT.none || "无"}
        </div>
        <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-warning">
          {(appT.unmappedFieldsLabel || "未映射字段") +
            ` (${activeImportFeedback.unmappedKeys.length}):`}
          {activeImportFeedback.unmappedKeys.length > 0
            ? activeImportFeedback.unmappedKeys.join(", ")
            : appT.none || "无"}
        </div>
      </CardContent>
    </Card>
  );
}
