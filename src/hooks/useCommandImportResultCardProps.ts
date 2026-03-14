import { useMemo } from "react";

import type { CommandImportResultCardProps } from "@/components/publish/CommandImportResultCard";

interface ImportFeedback {
  providerId: string;
  mappedKeys: string[];
  unmappedKeys: string[];
}

interface TranslationMap {
  [key: string]: string | undefined;
}

interface UseCommandImportResultCardPropsParams {
  activeImportFeedback: ImportFeedback | null;
  providerLabel: string;
  appT: TranslationMap;
}

export function useCommandImportResultCardProps(
  params: UseCommandImportResultCardPropsParams
): CommandImportResultCardProps | null {
  return useMemo(() => {
    if (!params.activeImportFeedback) {
      return null;
    }

    return {
      activeImportFeedback: params.activeImportFeedback,
      providerLabel: params.providerLabel,
      appT: params.appT,
    };
  }, [params]);
}
