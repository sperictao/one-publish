import { useCallback } from "react";

import { createDotnetPublishConfigFromParameters } from "@/lib/dotnetPublishConfig";
import type { ExecutionRecord, PublishConfigStore } from "@/lib/store";
import type { ParameterValue } from "@/types/parameters";
import type { ProviderPublishSpec } from "@/hooks/usePublishExecution";

interface UseRecoverableSpecParams {
  specVersion: number;
  applyDotnetCustomConfig: (config: PublishConfigStore) => void;
  setActiveProviderId: (providerId: string) => void;
  setProviderParameters: React.Dispatch<
    React.SetStateAction<Record<string, Record<string, ParameterValue>>>
  >;
}

export function useRecoverableSpec({
  specVersion,
  applyDotnetCustomConfig,
  setActiveProviderId,
  setProviderParameters,
}: UseRecoverableSpecParams) {
  const extractSpecFromRecord = useCallback(
    (record: ExecutionRecord): ProviderPublishSpec | null => {
      const raw = record.spec;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return null;
      }

      const payload = raw as Record<string, unknown>;
      const providerId = payload.provider_id;
      const projectPath = payload.project_path;
      if (typeof providerId !== "string" || typeof projectPath !== "string") {
        return null;
      }

      const version =
        typeof payload.version === "number" ? payload.version : specVersion;
      const parametersRaw = payload.parameters;
      const parameters =
        parametersRaw &&
        typeof parametersRaw === "object" &&
        !Array.isArray(parametersRaw)
          ? (parametersRaw as Record<string, unknown>)
          : {};

      return {
        version,
        provider_id: providerId,
        project_path: projectPath,
        parameters,
      };
    },
    [specVersion]
  );

  const restoreSpecToEditor = useCallback(
    (spec: ProviderPublishSpec) => {
      setActiveProviderId(spec.provider_id);

      if (spec.provider_id === "dotnet") {
        const parameters = spec.parameters || {};
        applyDotnetCustomConfig(
          createDotnetPublishConfigFromParameters(parameters, {
            inferProfileSelection: true,
          })
        );
      } else {
        setProviderParameters((prev) => ({
          ...prev,
          [spec.provider_id]: spec.parameters as Record<string, ParameterValue>,
        }));
      }
    },
    [
      applyDotnetCustomConfig,
      setActiveProviderId,
      setProviderParameters,
    ]
  );

  const getRecentConfigKeyFromSpec = useCallback((spec: ProviderPublishSpec) => {
    if (spec.provider_id !== "dotnet") {
      return null;
    }

    const propertiesRaw = spec.parameters?.properties;
    if (
      propertiesRaw &&
      typeof propertiesRaw === "object" &&
      !Array.isArray(propertiesRaw)
    ) {
      const profileName = (propertiesRaw as Record<string, unknown>).PublishProfile;
      if (typeof profileName === "string" && profileName.trim()) {
        return `pubxml:${profileName.trim()}`;
      }
    }

    return null;
  }, []);

  return {
    extractSpecFromRecord,
    restoreSpecToEditor,
    getRecentConfigKeyFromSpec,
  };
}
