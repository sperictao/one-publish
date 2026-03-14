import { useMemo } from "react";

import type { OutputLogCardProps } from "@/components/publish/OutputLogCard";
import type { ArtifactActionState } from "@/components/publish/ArtifactActions";
import type { PublishResult } from "@/hooks/usePublishExecution";

interface TranslationMap {
  [key: string]: string | undefined;
}

interface UseOutputLogCardPropsParams {
  outputLog: string;
  publishResult: PublishResult | null;
  appT: TranslationMap;
  isExportingSnapshot: boolean;
  exportExecutionSnapshot: () => void;
  setReleaseChecklistOpen: (open: boolean) => void;
  setArtifactActionState: (state: ArtifactActionState) => void;
}

export function useOutputLogCardProps(
  params: UseOutputLogCardPropsParams
): OutputLogCardProps {
  return useMemo(
    () => ({
      outputLog: params.outputLog,
      publishResult: params.publishResult,
      appT: params.appT,
      isExportingSnapshot: params.isExportingSnapshot,
      onExportExecutionSnapshot: params.exportExecutionSnapshot,
      onOpenReleaseChecklist: () => params.setReleaseChecklistOpen(true),
      onArtifactActionStateChange: params.setArtifactActionState,
    }),
    [params]
  );
}
