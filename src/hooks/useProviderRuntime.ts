import { useCallback, useEffect, useMemo, useState } from "react";

import {
  getProviderSchema,
  listProviders,
  type ProviderManifest,
} from "@/lib/store";
import type { ParameterSchema, ParameterValue } from "@/types/parameters";

export function useProviderRuntime() {
  const [providers, setProviders] = useState<ProviderManifest[]>([]);
  const [activeProviderId, setActiveProviderId] = useState("dotnet");
  const [providerSchemas, setProviderSchemas] = useState<
    Record<string, ParameterSchema>
  >({});
  const [providerParameters, setProviderParameters] = useState<
    Record<string, Record<string, ParameterValue>>
  >({});

  useEffect(() => {
    let mounted = true;

    listProviders()
      .then((items: ProviderManifest[]) => {
        if (!mounted) return;
        if (items.length > 0) {
          setProviders(items);
          if (!items.some((item) => item.id === activeProviderId)) {
            setActiveProviderId(items[0].id);
          }
        }
      })
      .catch((err: unknown) => {
        console.error("加载 Provider 列表失败:", err);
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (providerSchemas[activeProviderId]) return;

    let mounted = true;

    getProviderSchema(activeProviderId)
      .then((schema: ParameterSchema) => {
        if (!mounted) return;
        setProviderSchemas((prev) => ({
          ...prev,
          [activeProviderId]: schema,
        }));
      })
      .catch((err: unknown) => {
        console.error("加载 Provider Schema 失败:", err);
      });

    return () => {
      mounted = false;
    };
  }, [activeProviderId, providerSchemas]);

  const activeProvider = useMemo(
    () => providers.find((provider) => provider.id === activeProviderId) || null,
    [providers, activeProviderId]
  );

  const activeProviderSchema = providerSchemas[activeProviderId];
  const activeProviderParameters = providerParameters[activeProviderId] || {};

  const handleProviderParametersChange = useCallback(
    (parameters: Record<string, ParameterValue>) => {
      setProviderParameters((prev) => ({
        ...prev,
        [activeProviderId]: parameters,
      }));
    },
    [activeProviderId]
  );

  return {
    activeProviderId,
    setActiveProviderId,
    providerSchemas,
    setProviderParameters,
    availableProviders: providers,
    activeProvider,
    activeProviderSchema,
    activeProviderParameters,
    handleProviderParametersChange,
  };
}
