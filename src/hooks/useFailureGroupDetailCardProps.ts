import { useMemo, type Dispatch, type SetStateAction } from "react";

import type { FailureGroupDetailCardProps } from "@/components/publish/FailureGroupDetailCard";
import type { FailureGroup } from "@/lib/failureGroups";
import type { IssueDraftTemplate } from "@/lib/issueDraft";
import type { ExecutionRecord } from "@/lib/store";

interface TranslationMap {
  [key: string]: string | undefined;
}

interface IssueDraftSections {
  impact: boolean;
  workaround: boolean;
  owner: boolean;
}

interface UseFailureGroupDetailCardPropsParams {
  selectedFailureGroup: FailureGroup | null;
  representativeFailureRecord: ExecutionRecord | null;
  issueDraftTemplate: IssueDraftTemplate;
  issueDraftSections: IssueDraftSections;
  failureT: TranslationMap;
  appT: TranslationMap;
  isExportingFailureBundle: boolean;
  isPublishing: boolean;
  setIssueDraftTemplate: (value: IssueDraftTemplate) => void;
  setIssueDraftSections: Dispatch<SetStateAction<IssueDraftSections>>;
  copyGroupSignature: (group: FailureGroup) => Promise<void>;
  copyRecordCommand: (record: ExecutionRecord) => Promise<void>;
  copyFailureIssueDraft: (group: FailureGroup) => Promise<void>;
  exportFailureGroupBundle: () => void;
  openSnapshotFromRecord: (record: ExecutionRecord) => Promise<void>;
  rerunFromHistory: (record: ExecutionRecord) => Promise<void>;
}

export function useFailureGroupDetailCardProps(
  params: UseFailureGroupDetailCardPropsParams
): FailureGroupDetailCardProps {
  return useMemo(
    () => ({
      selectedFailureGroup: params.selectedFailureGroup,
      representativeFailureRecord: params.representativeFailureRecord,
      issueDraftTemplate: params.issueDraftTemplate,
      issueDraftSections: params.issueDraftSections,
      failureT: params.failureT,
      appT: params.appT,
      isExportingFailureBundle: params.isExportingFailureBundle,
      isPublishing: params.isPublishing,
      onIssueDraftTemplateChange: params.setIssueDraftTemplate,
      onToggleIssueDraftSection: (key) =>
        params.setIssueDraftSections((prev) => ({
          ...prev,
          [key]: !prev[key],
        })),
      onCopyGroupSignature: params.copyGroupSignature,
      onCopyRecordCommand: params.copyRecordCommand,
      onCopyFailureIssueDraft: params.copyFailureIssueDraft,
      onExportFailureGroupBundle: params.exportFailureGroupBundle,
      onOpenSnapshotFromRecord: params.openSnapshotFromRecord,
      onRerunFromHistory: params.rerunFromHistory,
    }),
    [params]
  );
}
