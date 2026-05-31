import { useCallback, useEffect, useMemo, useState } from "react";

import {
  getProviderSchema,
  listProviders,
} from "@/lib/store/api";
import {
  type ProviderManifest,
} from "@/lib/store/types";
import type { ParameterSchema } from "@/types/parameters";

export type ResourceStatus = "idle" | "loading" | "ready" | "error";

export interface ResourceState<T> {
  status: ResourceStatus;
  data: T | null;
  error: unknown | null;
}

type ProviderSchemaStateMap = Record<string, ResourceState<ParameterSchema>>;

function createIdleState<T>(): ResourceState<T> {
  return {
    status: "idle",
    data: null,
    error: null,
  };
}

export function useProviderRuntime() {
  const [providerListState, setProviderListState] = useState<
    ResourceState<ProviderManifest[]>
  >(createIdleState<ProviderManifest[]>);
  const [activeProviderId, setActiveProviderId] = useState("dotnet");
  const [providerSchemaStates, setProviderSchemaStates] =
    useState<ProviderSchemaStateMap>({});

  const loadProviders = useCallback(async () => {
    setProviderListState((prev) => ({
      status: "loading",
      data: prev.data,
      error: null,
    }));

    try {
      const items = await listProviders();
      setProviderListState({
        status: "ready",
        data: items,
        error: null,
      });
    } catch (error) {
      setProviderListState((prev) => ({
        status: "error",
        data: prev.data,
        error,
      }));
    }
  }, []);

  const loadProviderSchema = useCallback(async (providerId: string) => {
    setProviderSchemaStates((prev) => ({
      ...prev,
      [providerId]: {
        status: "loading",
        data: prev[providerId]?.data ?? null,
        error: null,
      },
    }));

    try {
      const schema = await getProviderSchema(providerId);
      setProviderSchemaStates((prev) => ({
        ...prev,
        [providerId]: {
          status: "ready",
          data: schema,
          error: null,
        },
      }));
    } catch (error) {
      setProviderSchemaStates((prev) => ({
        ...prev,
        [providerId]: {
          status: "error",
          data: prev[providerId]?.data ?? null,
          error,
        },
      }));
    }
  }, []);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  useEffect(() => {
    const availableProviderIds = (providerListState.data ?? []).map(
      (provider) => provider.id
    );
    if (
      availableProviderIds.length > 0 &&
      !availableProviderIds.includes(activeProviderId)
    ) {
      setActiveProviderId(availableProviderIds[0]);
    }
  }, [activeProviderId, providerListState.data]);

  useEffect(() => {
    const schemaState =
      providerSchemaStates[activeProviderId] ?? createIdleState<ParameterSchema>();
    if (!activeProviderId || schemaState.status !== "idle") {
      return;
    }

    void loadProviderSchema(activeProviderId);
  }, [activeProviderId, loadProviderSchema, providerSchemaStates]);

  const availableProviders = providerListState.data ?? [];
  const activeProvider = useMemo(
    () => availableProviders.find((provider) => provider.id === activeProviderId) || null,
    [availableProviders, activeProviderId]
  );
  const activeProviderSchemaState =
    providerSchemaStates[activeProviderId] ?? createIdleState<ParameterSchema>();
  const providerSchemas = useMemo(
    () => {
      const entries: [string, ParameterSchema][] = [];

      for (const [providerId, state] of Object.entries(providerSchemaStates)) {
        if (state.status === "ready" && state.data) {
          entries.push([providerId, state.data]);
        }
      }

      return Object.fromEntries(entries);
    },
    [providerSchemaStates]
  );
  const activeProviderSchema = activeProviderSchemaState.data ?? undefined;

  const retryProviderList = useCallback(() => {
    void loadProviders();
  }, [loadProviders]);

  const retryProviderSchema = useCallback(
    (providerId = activeProviderId) => {
      if (!providerId) {
        return;
      }
      void loadProviderSchema(providerId);
    },
    [activeProviderId, loadProviderSchema]
  );

  return {
    activeProviderId,
    setActiveProviderId,
    providerListState,
    providerSchemaStates,
    activeProviderSchemaState,
    retryProviderList,
    retryProviderSchema,
    providerSchemas,
    availableProviders,
    activeProvider,
    activeProviderSchema,
  };
}
