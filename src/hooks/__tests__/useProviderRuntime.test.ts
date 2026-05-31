import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listProviders: vi.fn(),
  getProviderSchema: vi.fn(),
}));

vi.mock("@/lib/store/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/store/api")>("@/lib/store/api");
  return {
    ...actual,
    listProviders: mocks.listProviders,
    getProviderSchema: mocks.getProviderSchema,
  };
});

import { useProviderRuntime } from "@/features/provider/useProviderRuntime";

describe("useProviderRuntime", () => {
  const dotnetProvider = {
    id: "dotnet",
    displayName: ".NET (dotnet)",
    version: "1.0.0",
    label: ".NET (dotnet)",
    commandExample:
      "dotnet publish MyProject.csproj -c Release -r win-x64 --self-contained",
    environmentLabel: ".NET",
    environmentDescription: "dotnet SDK",
    requiresProjectBinding: true,
    projectPathKind: "project_file" as const,
    supportsCommandImport: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("provider 列表加载失败后可通过 retry 恢复", async () => {
    mocks.listProviders
      .mockRejectedValueOnce(new Error("provider list failed"))
      .mockResolvedValueOnce([dotnetProvider]);
    mocks.getProviderSchema.mockResolvedValue({
      parameters: {},
    });

    const { result } = renderHook(() => useProviderRuntime());

    await waitFor(() => {
      expect(result.current.providerListState.status).toBe("error");
    });

    act(() => {
      result.current.retryProviderList();
    });

    await waitFor(() => {
      expect(result.current.providerListState.status).toBe("ready");
      expect(result.current.availableProviders).toHaveLength(1);
    });
  });

  it("schema 加载失败后会暴露错误态，并支持 retry", async () => {
    mocks.listProviders.mockResolvedValue([dotnetProvider]);
    mocks.getProviderSchema
      .mockRejectedValueOnce(new Error("schema failed"))
      .mockResolvedValueOnce({
        parameters: {
          configuration: {
            type: "string",
            flag: "--configuration",
            multiple: null,
            prefix: null,
            description: null,
          },
        },
      });

    const { result } = renderHook(() => useProviderRuntime());

    await waitFor(() => {
      expect(result.current.activeProviderSchemaState.status).toBe("error");
    });

    act(() => {
      result.current.retryProviderSchema();
    });

    await waitFor(() => {
      expect(result.current.activeProviderSchemaState.status).toBe("ready");
      expect(result.current.providerSchemas.dotnet).toBeDefined();
    });
  });

  it("切换 activeProviderId 不会重复请求 provider 列表", async () => {
    mocks.listProviders.mockResolvedValue([
      dotnetProvider,
      {
        ...dotnetProvider,
        id: "java",
        displayName: "java",
        label: "Java (Gradle)",
        commandExample: "./gradlew build --info",
        environmentLabel: "Java (Gradle)",
        environmentDescription: "gradle / java runtime",
        requiresProjectBinding: false,
        projectPathKind: "repository_root" as const,
      },
    ]);
    mocks.getProviderSchema.mockResolvedValue({ parameters: {} });

    const { result } = renderHook(() => useProviderRuntime());

    await waitFor(() => {
      expect(result.current.providerListState.status).toBe("ready");
    });

    expect(mocks.listProviders).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.setActiveProviderId("java");
    });

    await waitFor(() => {
      expect(result.current.activeProviderId).toBe("java");
      expect(result.current.activeProviderSchemaState.status).toBe("ready");
    });

    expect(mocks.listProviders).toHaveBeenCalledTimes(1);
  });
});
