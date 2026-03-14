import { useMemo } from "react";

import type { FailureGroupsCardProps } from "@/components/publish/FailureGroupsCard";
import type { FailureGroup } from "@/lib/failureGroups";

interface TranslationMap {
  [key: string]: string | undefined;
}

interface UseFailureGroupsCardPropsParams {
  failureGroups: FailureGroup[];
  selectedFailureGroupKey: string | null;
  failureT: TranslationMap;
  isPublishing: boolean;
  setSelectedFailureGroupKey: (key: string) => void;
  copyGroupSignature: (group: FailureGroup) => Promise<void>;
  openSnapshotFromRecord: (record: FailureGroup["latestRecord"]) => Promise<void>;
  rerunFromHistory: (record: FailureGroup["latestRecord"]) => Promise<void>;
}

export function useFailureGroupsCardProps(
  params: UseFailureGroupsCardPropsParams
): FailureGroupsCardProps {
  return useMemo(
    () => ({
      failureGroups: params.failureGroups,
      selectedFailureGroupKey: params.selectedFailureGroupKey,
      failureT: params.failureT,
      isPublishing: params.isPublishing,
      onSelectFailureGroup: params.setSelectedFailureGroupKey,
      onCopyGroupSignature: params.copyGroupSignature,
      onOpenSnapshotFromRecord: params.openSnapshotFromRecord,
      onRerunFromHistory: params.rerunFromHistory,
    }),
    [params]
  );
}
