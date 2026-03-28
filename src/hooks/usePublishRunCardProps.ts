import { useMemo } from "react";

import type {
  PublishRunCardActions,
  PublishRunCardProps,
} from "@/components/publish/PublishRunCard";
import type { PublishResult } from "@/hooks/usePublishRunner";

interface TranslationMap {
  [key: string]: string | undefined;
}

interface UsePublishRunCardPropsParams {
  outputLog: string;
  publishResult: PublishResult | null;
  appT: TranslationMap;
  publishActions: PublishRunCardActions | null;
}

export function usePublishRunCardProps(
  params: UsePublishRunCardPropsParams
): PublishRunCardProps {
  return useMemo(
    () => ({
      outputLog: params.outputLog,
      publishResult: params.publishResult,
      appT: params.appT,
      publishActions: params.publishActions,
    }),
    [params]
  );
}
