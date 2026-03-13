import {
  useCallback,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { toast } from "sonner";

import { mapImportedSpecByProvider } from "@/lib/commandImportMapping";
import type { ParameterSchema, ParameterValue } from "@/types/parameters";

export interface ImportFeedback {
  providerId: string;
  mappedKeys: string[];
  unmappedKeys: string[];
}

interface TranslationMap {
  [key: string]: string | undefined;
}

interface DotnetConfigPatch {
  configuration?: string;
  runtime?: string;
  outputDir?: string;
  selfContained?: boolean;
  useProfile?: boolean;
  profileName?: string;
}

interface UseCommandImportParams {
  activeProviderId: string;
  appT: TranslationMap;
  providerSchemas: Record<string, ParameterSchema>;
  onDotnetConfigUpdate: (patch: DotnetConfigPatch) => void;
  onEnableCustomMode: () => void;
  setProviderParameters: Dispatch<
    SetStateAction<Record<string, Record<string, ParameterValue>>>
  >;
}

export function useCommandImport({
  activeProviderId,
  appT,
  providerSchemas,
  onDotnetConfigUpdate,
  onEnableCustomMode,
  setProviderParameters,
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
    (spec: any) => {
      const importedProviderId =
        spec?.provider_id || spec?.providerId || activeProviderId;
      const schema = providerSchemas[importedProviderId];
      const mapping = mapImportedSpecByProvider(spec, activeProviderId, {
        supportedKeys: schema ? Object.keys(schema.parameters) : undefined,
      });

      setLastImportFeedback({
        providerId: mapping.providerId,
        mappedKeys: mapping.mappedKeys,
        unmappedKeys: mapping.unmappedKeys,
      });

      if (mapping.providerId === "dotnet") {
        if (Object.keys(mapping.dotnetUpdates).length > 0) {
          onDotnetConfigUpdate(mapping.dotnetUpdates);
          onEnableCustomMode();
        }
      } else {
        setProviderParameters((prev) => ({
          ...prev,
          [mapping.providerId]: mapping.providerParameters,
        }));
      }

      if (mapping.mappedKeys.length === 0 && mapping.unmappedKeys.length > 0) {
        toast.error(appT.noMappableParameters || "未找到可映射参数", {
          description: `${appT.unmappedFields || "未映射字段"}: ${mapping.unmappedKeys.join(", ")}`,
        });
        return;
      }

      if (mapping.unmappedKeys.length > 0) {
        toast.message(appT.partialImport || "参数已部分导入", {
          description: `${appT.mappedFields || "已映射"} ${mapping.mappedKeys.length} ${appT.fieldsUnit || "个字段"}，${appT.unmappedFields || "未映射字段"} ${mapping.unmappedKeys.length} ${appT.fieldsUnit || "个字段"}`,
        });
        return;
      }

      toast.success(appT.parametersImported || "参数已导入", {
        description: `${appT.mappedFields || "已映射"} ${mapping.mappedKeys.length} ${appT.fieldsUnit || "个字段"}`,
      });
    },
    [
      activeProviderId,
      appT.fieldsUnit,
      appT.parametersImported,
      appT.mappedFields,
      appT.noMappableParameters,
      appT.partialImport,
      appT.unmappedFields,
      onDotnetConfigUpdate,
      onEnableCustomMode,
      providerSchemas,
      setProviderParameters,
    ]
  );

  return {
    activeImportFeedback,
    handleCommandImport,
  };
}
