import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listProviders: vi.fn(),
  getProviderSchema: vi.fn(),
}));

vi.mock("@/lib/store", async () => {
  const actual = await vi.importActual<typeof import("@/lib/store")>("@/lib/store");
  return {
    ...actual,
    listProviders: mocks.listProviders,
    getProviderSchema: mocks.getProviderSchema,
  };
});

import { useProviderRuntime } from "@/hooks/useProviderRuntime";

describe("useProviderRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("provider 列表加载失败后可通过 retry 恢复", async () => {
    mocks.listProviders
      .mockRejectedValueOnce(new Error("provider list failed"))
      .mockResolvedValueOnce([
        {
          id: "dotnet",
          displayName: ".NET",
          version: "1.0.0",
        },
      ]);
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
    mocks.listProviders.mockResolvedValue([
      {
        id: "dotnet",
        displayName: ".NET",
        version: "1.0.0",
      },
    ]);
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
});
