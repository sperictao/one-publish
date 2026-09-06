import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import type {
  CommandImportDiagnostic,
  CommandImportResult,
} from "@/features/publish/publishRuntime";

export interface ImportFeedback {
  providerId: string;
  diagnostics: CommandImportDiagnostic[];
}

interface TranslationMap {
  [key: string]: string | undefined;
}

interface UseCommandImportParams {
  activeProviderId: string;
  appT: TranslationMap;
  onImportDraft: (result: CommandImportResult) => void;
}

export function useCommandImport({
  activeProviderId,
  appT,
  onImportDraft,
}: UseCommandImportParams) {
  const [lastImportFeedback, setLastImportFeedback] =
    useState<ImportFeedback | null>(null);

  const activeImportFeedback = useMemo(
    () =>
      lastImportFeedback?.providerId === activeProviderId
        ? lastImportFeedback
        : null,
    [activeProviderId, lastImportFeedback]
  );

  const handleCommandImport = useCallback(
    (result: CommandImportResult) => {
      const providerId = result.providerId || activeProviderId;
      setLastImportFeedback({ providerId, diagnostics: result.diagnostics });

      onImportDraft({ ...result, providerId });

      if (result.diagnostics.length > 0) {
        toast.warning(appT.partialImport || "参数已部分导入", {
          description: result.diagnostics
            .map((diagnostic) => diagnostic.message)
            .join(", "),
        });
        return;
      }

      toast.success(appT.parametersImported || "参数已导入");
    },
    [
      activeProviderId,
      appT.partialImport,
      appT.parametersImported,
      onImportDraft,
    ]
  );

  return {
    activeImportFeedback,
    handleCommandImport,
  };
}
