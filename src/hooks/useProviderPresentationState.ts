import { useMemo } from "react";

import type { ProviderManifest } from "@/lib/store";
import {
  providerRequiresProjectBinding,
  providerUsesProjectFile,
  resolveProviderLabel,
} from "@/lib/providers";
import type { ResourceState } from "@/hooks/useProviderRuntime";
import type { ParameterSchema } from "@/types/parameters";

interface ProviderRuntimeCopy {
  loadingProviders?: string;
  loadingProvidersDescription?: string;
  providerListLoadFailed?: string;
  providerListLoadFailedDescription?: string;
  loadingProviderSchema?: string;
  loadingProviderSchemaDescription?: string;
  providerSchemaLoadFailed?: string;
  providerSchemaLoadFailedDescription?: string;
}

export interface ProviderRuntimeBannerState {
  key: string;
  status: "loading" | "error";
  title: string;
  description: string;
  onRetry: () => void;
}

function describeRuntimeError(error: unknown, fallback: string): string {
  if (error === null || error === undefined) {
    return fallback;
  }

  const description = String(error).trim();
  return description || fallback;
}

export function useProviderPresentationState(params: {
  providerRuntimeProviders: ProviderManifest[];
  providerListState: ResourceState<ProviderManifest[]>;
  activeProviderSchemaState: ResourceState<ParameterSchema>;
  activeProvider: ProviderManifest | null;
  activeProviderId: string;
  appT: ProviderRuntimeCopy;
  retryProviderList: () => void;
  retryProviderSchema: () => void;
}) {
  const availableProviders = useMemo(
    () => params.providerRuntimeProviders,
    [params.providerRuntimeProviders]
  );

  const resolvedActiveProvider = useMemo(
    () =>
      params.activeProvider ||
      availableProviders.find((provider) => provider.id === params.activeProviderId) ||
      availableProviders[0] ||
      null,
    [params.activeProvider, params.activeProviderId, availableProviders]
  );

  const activeProviderLabel = useMemo(
    () => resolveProviderLabel(resolvedActiveProvider, params.activeProviderId),
    [params.activeProviderId, resolvedActiveProvider]
  );
  const activeProviderUsesProjectFile = useMemo(
    () => providerUsesProjectFile(resolvedActiveProvider),
    [resolvedActiveProvider]
  );
  const activeProviderRequiresProjectBinding = useMemo(
    () => providerRequiresProjectBinding(resolvedActiveProvider),
    [resolvedActiveProvider]
  );

  const repositoryProviders = useMemo(
    () =>
      availableProviders.map((provider) => ({
        ...provider,
        label: resolveProviderLabel(provider),
      })),
    [availableProviders]
  );

  const providerRuntimeBanner = useMemo<ProviderRuntimeBannerState | null>(() => {
    if (
      params.providerListState.status === "loading" &&
      !params.providerListState.data?.length
    ) {
      return {
        key: "provider-loading",
        status: "loading",
        title: params.appT.loadingProviders || "正在加载 Provider 列表...",
        description:
          params.appT.loadingProvidersDescription ||
          "等待 Provider 运行时初始化完成后，参数编辑和命令导入功能才会恢复。",
        onRetry: params.retryProviderList,
      };
    }

    if (params.providerListState.status === "error") {
      return {
        key: "provider-error",
        status: "error",
        title: params.appT.providerListLoadFailed || "Provider 列表加载失败",
        description: describeRuntimeError(
          params.providerListState.error,
          params.appT.providerListLoadFailedDescription ||
            "未能读取可用 Provider，请重试。"
        ),
        onRetry: params.retryProviderList,
      };
    }

    if (
      params.activeProviderSchemaState.status === "loading" &&
      !params.activeProviderSchemaState.data
    ) {
      return {
        key: "provider-schema-loading",
        status: "loading",
        title: params.appT.loadingProviderSchema || "正在加载 Provider 参数定义...",
        description:
          params.appT.loadingProviderSchemaDescription ||
          "参数表单和命令映射会在 schema 就绪后继续可用。",
        onRetry: params.retryProviderSchema,
      };
    }

    if (params.activeProviderSchemaState.status === "error") {
      return {
        key: "provider-schema-error",
        status: "error",
        title: params.appT.providerSchemaLoadFailed || "Provider 参数定义加载失败",
        description: describeRuntimeError(
          params.activeProviderSchemaState.error,
          params.appT.providerSchemaLoadFailedDescription ||
            "无法读取当前 Provider 的参数定义，请重试。"
        ),
        onRetry: params.retryProviderSchema,
      };
    }

    return null;
  }, [
    params.activeProviderSchemaState,
    params.appT.loadingProviderSchema,
    params.appT.loadingProviderSchemaDescription,
    params.appT.loadingProviders,
    params.appT.loadingProvidersDescription,
    params.appT.providerListLoadFailed,
    params.appT.providerListLoadFailedDescription,
    params.appT.providerSchemaLoadFailed,
    params.appT.providerSchemaLoadFailedDescription,
    params.providerListState,
    params.retryProviderList,
    params.retryProviderSchema,
  ]);

  return {
    availableProviders,
    resolvedActiveProvider,
    activeProviderLabel,
    activeProviderUsesProjectFile,
    activeProviderRequiresProjectBinding,
    repositoryProviders,
    providerRuntimeBanner,
  };
}
