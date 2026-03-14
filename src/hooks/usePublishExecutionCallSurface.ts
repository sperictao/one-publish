import { useMemo } from "react";

import type { EnvironmentCheckResult } from "@/lib/environment";
import type { ExecutionRecord } from "@/lib/store";
import type {
  ProviderPublishSpec,
  PublishResult,
} from "@/hooks/usePublishExecution";

export interface PublishExecutionCallSurface {
  pushRecentConfig: (key: string, repoId?: string | null) => void;
  openEnvironmentDialog: (
    initialResult?: EnvironmentCheckResult | null,
    providerIds?: string[]
  ) => void;
  setEnvironmentLastResult: (result: EnvironmentCheckResult | null) => void;
  buildExecutionRecord: (params: {
    spec: ProviderPublishSpec;
    repoId: string | null;
    startedAt: string;
    finishedAt: string;
    result: PublishResult;
    output: string;
  }) => ExecutionRecord;
  persistExecutionRecord: (record: ExecutionRecord) => void;
}

interface UsePublishExecutionCallSurfaceParams {
  pushRecentConfig: PublishExecutionCallSurface["pushRecentConfig"];
  openEnvironmentDialog: PublishExecutionCallSurface["openEnvironmentDialog"];
  setEnvironmentLastResult: PublishExecutionCallSurface["setEnvironmentLastResult"];
  buildExecutionRecord: PublishExecutionCallSurface["buildExecutionRecord"];
  persistExecutionRecord: PublishExecutionCallSurface["persistExecutionRecord"];
}

export function usePublishExecutionCallSurface(
  params: UsePublishExecutionCallSurfaceParams
): PublishExecutionCallSurface {
  return useMemo(
    () => ({
      pushRecentConfig: params.pushRecentConfig,
      openEnvironmentDialog: params.openEnvironmentDialog,
      setEnvironmentLastResult: params.setEnvironmentLastResult,
      buildExecutionRecord: params.buildExecutionRecord,
      persistExecutionRecord: params.persistExecutionRecord,
    }),
    [params]
  );
}
