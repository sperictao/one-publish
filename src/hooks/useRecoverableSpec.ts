import { useCallback } from "react";

import { createDotnetPublishConfigFromParameters } from "@/features/config/dotnetPublishConfig";
import { createProjectProfileConfigKey } from "@/features/config/publishConfigIdentity";
import type { ExecutionRecord, PublishConfigStore } from "@/lib/store/types";
import {
  fromSpecParameters,
  type ParameterValue,
  type SpecParameters,
} from "@/types/parameters";
import type { ProviderPublishSpec } from "@/features/publish/publishRuntime";

interface UseRecoverableSpecParams {
  specVersion: number;
  setCustomConfig: (config: PublishConfigStore) => void;
  setIsCustomMode: (value: boolean) => void;
  applyRecoveredSpecProvider: (providerId: string) => void;
  setProviderParameters: React.Dispatch<
    React.SetStateAction<Record<string, Record<string, ParameterValue>>>
  >;
}

export function useRecoverableSpec({
  specVersion,
  setCustomConfig,
  setIsCustomMode,
  applyRecoveredSpecProvider,
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
          ? (parametersRaw as SpecParameters)
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
      applyRecoveredSpecProvider(spec.provider_id);

      if (spec.provider_id === "dotnet") {
        const parameters = spec.parameters || {};
        setCustomConfig(
          createDotnetPublishConfigFromParameters(parameters, {
            inferProfileSelection: true,
          })
        );

        setIsCustomMode(true);
      } else {
        setProviderParameters((prev) => ({
          ...prev,
          [spec.provider_id]: fromSpecParameters(spec.parameters),
        }));
      }
    },
    [
      applyRecoveredSpecProvider,
      setCustomConfig,
      setIsCustomMode,
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
        return createProjectProfileConfigKey(profileName);
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
