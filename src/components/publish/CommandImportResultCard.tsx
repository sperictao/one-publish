import { Import } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { CommandImportDiagnostic } from "@/features/publish/publishRuntime";

interface ImportFeedback {
  providerId: string;
  diagnostics: CommandImportDiagnostic[];
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
        <CardTitle className="text-heading-20 flex items-center gap-2">
          <Import className="size-5" />
          {appT.commandImportResult || "命令导入结果"}
        </CardTitle>
        <CardDescription>Provider: {providerLabel}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-copy-14">
        <div className="status-cancelled rounded-sm px-3 py-2">
          {(appT.commandImportDiagnostics || "解析诊断") +
            ` (${activeImportFeedback.diagnostics.length}):`}
          {activeImportFeedback.diagnostics.length > 0 ? (
            <ul className="mt-1 space-y-1">
              {activeImportFeedback.diagnostics.map((diagnostic, index) => (
                <li
                  key={`${diagnostic.code}-${index}`}
                  className="font-mono text-label-13-mono"
                >
                  {diagnostic.message}
                </li>
              ))}
            </ul>
          ) : (
            appT.none || "无"
          )}
        </div>
      </CardContent>
    </Card>
  );
}
