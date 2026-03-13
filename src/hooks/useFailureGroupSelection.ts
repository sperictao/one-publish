import { useEffect, useMemo, useState } from "react";

import { getRepresentativeRecord, type FailureGroup } from "@/lib/failureGroups";

export function useFailureGroupSelection(failureGroups: FailureGroup[]) {
  const [selectedFailureGroupKey, setSelectedFailureGroupKey] =
    useState<string | null>(null);

  useEffect(() => {
    if (failureGroups.length === 0) {
      if (selectedFailureGroupKey !== null) {
        setSelectedFailureGroupKey(null);
      }
      return;
    }

    if (
      !selectedFailureGroupKey ||
      !failureGroups.some((group) => group.key === selectedFailureGroupKey)
    ) {
      setSelectedFailureGroupKey(failureGroups[0].key);
    }
  }, [failureGroups, selectedFailureGroupKey]);

  const selectedFailureGroup = useMemo(
    () =>
      failureGroups.find((group) => group.key === selectedFailureGroupKey) ||
      null,
    [failureGroups, selectedFailureGroupKey]
  );

  const representativeFailureRecord = useMemo(
    () =>
      selectedFailureGroup ? getRepresentativeRecord(selectedFailureGroup) : null,
    [selectedFailureGroup]
  );

  return {
    selectedFailureGroupKey,
    setSelectedFailureGroupKey,
    selectedFailureGroup,
    representativeFailureRecord,
  };
}
