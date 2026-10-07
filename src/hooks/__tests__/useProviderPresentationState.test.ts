import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useProviderPresentationState } from "@/features/provider/useProviderPresentationState";
import type { ResourceState } from "@/features/provider/useProviderRuntime";
import type { ProviderManifest } from "@/lib/store/types";
import type { ParameterSchema } from "@/types/parameters";

// 用真实 zh 文案，顺带校验后端错误码已在 `errors.<code>` 登记。
vi.mock("@/hooks/useI18n", async () => {
  const zh = (await import("@/i18n/zh.json")).default;
  return { useI18n: () => ({ translations: zh }) };
});

const dotnetProvider: ProviderManifest = {
  id: "dotnet",
  displayName: ".NET (dotnet)",
  version: "1.0.0",
  label: ".NET (dotnet)",
  commandExample:
    "dotnet publish MyProject.csproj -c Release -r win-x64 --self-contained",
  environmentLabel: ".NET",
  environmentDescription: "dotnet SDK",
  requiresProjectBinding: true,
  projectPathKind: "project_file",
  supportsCommandImport: true,
};

const cargoProvider: ProviderManifest = {
  id: "cargo",
  displayName: "cargo",
  version: "1.0.0",
  label: "Rust (cargo)",
  commandExample: "cargo build --release",
  environmentLabel: "Rust",
  environmentDescription: "cargo",
  requiresProjectBinding: false,
  projectPathKind: "repository_root",
  supportsCommandImport: true,
};

const readyProviders = (
  providers: ProviderManifest[]
): ResourceState<ProviderManifest[]> => ({
  status: "ready",
  data: providers,
  error: null,
});

const idleSchema: ResourceState<ParameterSchema> = {
  status: "idle",
  data: null,
  error: null,
};

describe("useProviderPresentationState", () => {
  it("derives active provider label, repository options, and project binding capability", () => {
    const { result } = renderHook(() =>
      useProviderPresentationState({
        providerRuntimeProviders: [dotnetProvider, cargoProvider],
        providerListState: readyProviders([dotnetProvider, cargoProvider]),
        activeProviderSchemaState: idleSchema,
        activeProvider: cargoProvider,
        activeProviderId: "cargo",
        appT: {},
        retryProviderList: vi.fn(),
        retryProviderSchema: vi.fn(),
      })
    );

    expect(result.current.activeProviderLabel).toBe("Rust (cargo)");
    expect(result.current.activeProviderUsesProjectFile).toBe(false);
    expect(result.current.activeProviderRequiresProjectBinding).toBe(false);
    expect(
      result.current.repositoryProviders.map((provider) => provider.label)
    ).toEqual([".NET (dotnet)", "Rust (cargo)"]);
    expect(result.current.providerRuntimeBanner).toBeNull();
  });

  it("builds provider list and schema runtime banners outside App", () => {
    const retryProviderList = vi.fn();
    const retryProviderSchema = vi.fn();

    const { result, rerender } = renderHook(
      ({
        providerListState,
        activeProviderSchemaState,
      }: {
        providerListState: ResourceState<ProviderManifest[]>;
        activeProviderSchemaState: ResourceState<ParameterSchema>;
      }) =>
        useProviderPresentationState({
          providerRuntimeProviders: [],
          providerListState,
          activeProviderSchemaState,
          activeProvider: null,
          activeProviderId: "dotnet",
          appT: {
            providerListLoadFailed: "Provider list failed",
            providerListLoadFailedDescription: "Retry provider list",
            providerSchemaLoadFailed: "Provider schema failed",
            providerSchemaLoadFailedDescription: "Retry provider schema",
          },
          retryProviderList,
          retryProviderSchema,
        }),
      {
        initialProps: {
          providerListState: {
            status: "error",
            data: null,
            error: null,
          },
          activeProviderSchemaState: idleSchema,
        },
      }
    );

    expect(result.current.providerRuntimeBanner).toMatchObject({
      key: "provider-error",
      title: "Provider list failed",
      description: "Retry provider list",
      onRetry: retryProviderList,
    });

    rerender({
      providerListState: readyProviders([dotnetProvider]),
      activeProviderSchemaState: {
        status: "error",
        data: null,
        error: new Error("schema unavailable"),
      },
    });

    expect(result.current.providerRuntimeBanner).toMatchObject({
      key: "provider-schema-error",
      title: "Provider schema failed",
      description: "schema unavailable",
      onRetry: retryProviderSchema,
    });

    // Tauri invoke 以 AppError 对象 reject：按错误码本地化，而不是渲染 [object Object]。
    rerender({
      providerListState: readyProviders([dotnetProvider]),
      activeProviderSchemaState: {
        status: "error",
        data: null,
        error: {
          kind: "provider",
          message: "failed to load schema",
          details: "schema.json: No such file or directory",
          code: "provider_schema_load_failed",
        },
      },
    });

    expect(result.current.providerRuntimeBanner).toMatchObject({
      key: "provider-schema-error",
      description:
        "无法加载 Provider 参数定义 | schema.json: No such file or directory",
    });
  });
});
