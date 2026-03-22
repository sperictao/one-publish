import { useMemo } from "react";

import type {
  OutputLogCardProps,
  OutputLogCardPublishControls,
} from "@/components/publish/OutputLogCard";
import type { PublishResult } from "@/hooks/usePublishExecution";

interface TranslationMap {
  [key: string]: string | undefined;
}

interface UseOutputLogCardPropsParams {
  outputLog: string;
  publishResult: PublishResult | null;
  appT: TranslationMap;
  publishControls: OutputLogCardPublishControls | null;
}

export function useOutputLogCardProps(
  params: UseOutputLogCardPropsParams
): OutputLogCardProps {
  return useMemo(
    () => ({
      outputLog: params.outputLog,
      publishResult: params.publishResult,
      appT: params.appT,
      publishControls: params.publishControls,
    }),
    [params]
  );
}
