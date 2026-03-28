import { useMemo } from "react";

import type { EnvironmentCheckResult } from "@/lib/environment";
import type { ExecutionRecord } from "@/lib/store";
import type {
  ProviderPublishSpec,
  PublishResult,
} from "@/hooks/usePublishRunner";

export interface PublishRunnerCallbacks {
  pushRecentConfig: (key: string, repoId?: string | null) => void;
  openEnvironmentDialog: (
    initialResult?: EnvironmentCheckResult | null,
    providerIds?: string[]
  ) => void;
  setEnvironmentLastResult: (result: EnvironmentCheckResult | null) => void;
  createPublishRecord: (params: {
    spec: ProviderPublishSpec;
    repoId: string | null;
    startedAt: string;
    finishedAt: string;
    result: PublishResult;
    output: string;
  }) => ExecutionRecord;
  savePublishRecord: (record: ExecutionRecord) => void;
}

interface UsePublishRunnerCallbacksParams {
  pushRecentConfig: PublishRunnerCallbacks["pushRecentConfig"];
  openEnvironmentDialog: PublishRunnerCallbacks["openEnvironmentDialog"];
  setEnvironmentLastResult: PublishRunnerCallbacks["setEnvironmentLastResult"];
  createPublishRecord: PublishRunnerCallbacks["createPublishRecord"];
  savePublishRecord: PublishRunnerCallbacks["savePublishRecord"];
}

export function usePublishRunnerCallbacks(
  params: UsePublishRunnerCallbacksParams
): PublishRunnerCallbacks {
  return useMemo(
    () => ({
      pushRecentConfig: params.pushRecentConfig,
      openEnvironmentDialog: params.openEnvironmentDialog,
      setEnvironmentLastResult: params.setEnvironmentLastResult,
      createPublishRecord: params.createPublishRecord,
      savePublishRecord: params.savePublishRecord,
    }),
    [params]
  );
}
