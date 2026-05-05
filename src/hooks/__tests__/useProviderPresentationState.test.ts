import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useProviderPresentationState } from "@/hooks/useProviderPresentationState";
import type { ResourceState } from "@/hooks/useProviderRuntime";
import type { ProviderManifest } from "@/lib/store";
import type { ParameterSchema } from "@/types/parameters";

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
    expect(result.current.repositoryProviders.map((provider) => provider.label)).toEqual([
      ".NET (dotnet)",
      "Rust (cargo)",
    ]);
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
      description: "Error: schema unavailable",
      onRetry: retryProviderSchema,
    });
  });
});
