import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type {
  ScopedPublishDraft,
  PreparedPublishRuntime,
} from "@/generated/tauri-contracts";
import {
  resolveSelectedPublishSource,
  usePublishValidate,
  type UsePublishValidateParams,
} from "../usePublishValidate";

const prepare = vi.hoisted(() => vi.fn());
vi.mock("../publishRuntime", async () => ({
  ...(await vi.importActual<typeof import("../publishRuntime")>(
    "../publishRuntime"
  )),
  preparePublishRuntime: prepare,
}));

const parameters = {
  self_contained: false,
  no_restore: false,
  nullable: null,
  empty: "",
  releaseSettings: { provider: "custom", enabled: false },
  unknown: { nested: [false, null] },
};
function draft(binding = "project-a"): ScopedPublishDraft {
  return {
    providerId: "dotnet",
    projectBinding: binding,
    baseRevision: { configurationId: "config", revisionId: "revision" },
    content: {
      providerId: "dotnet",
      contractVersion: 2,
      providerVersion: "3",
      settingsVersion: 4,
      projectBinding: binding,
      parameters,
      composition: {
        executionBackend: {
          adapterId: "runner",
          settingsVersion: 1,
          settings: { custom: true },
          credentials: {},
        },
        artifactStore: {
          adapterId: "store",
          settingsVersion: 1,
          settings: {},
          credentials: {},
        },
        artifactProcessors: [],
        deliveryRoutes: [],
      },
    },
  };
}
function repo() {
  return {
    path: "/repo",
    publishConfig: {
      selection: {
        kind: "draft" as const,
        providerId: "dotnet",
        projectBinding: "project-b",
      },
      drafts: [draft(), draft("project-b")],
      profiles: [],
    },
  };
}
function props(): UsePublishValidateParams {
  return {
    activeProviderId: "dotnet",
    activeProviderUsesProjectFile: true,
    activeProviderParameters: { wrong: true },
    customConfig: {} as UsePublishValidateParams["customConfig"],
    selectionKey: "draft",
    projectInfo: null,
    specVersion: 1,
    selectedRepoId: "repo",
    selectedRepo: repo(),
    appT: {},
    outputLog: "",
    defaultOutputDir: "/old",
    resetLogCapture: vi.fn(),
    notifyFeedback: vi.fn(),
    syncTrayPublishStatus: vi.fn(),
    restoreMainWindowIfNeeded: vi.fn(),
    openEnvironmentDialog: vi.fn(),
    setEnvironmentLastCheck: vi.fn(),
  };
}
const blocked: PreparedPublishRuntime = {
  status: "blocked",
  diagnostics: [{ code: "invalid", message: "invalid" }],
};

describe("stored publish source", () => {
  beforeEach(() => prepare.mockReset());
  it("selects complete scoped content and base revision without parameter conversion", () => {
    const repository = repo();
    expect(resolveSelectedPublishSource(repository, "npm")).toEqual({
      kind: "draft",
      content: repository.publishConfig.drafts[1].content,
      base_revision: repository.publishConfig.drafts[1].baseRevision,
    });
  });
  it("rejects missing, duplicate, or mismatched stored drafts", () => {
    const repository = repo();
    repository.publishConfig.drafts = [draft()];
    expect(() => resolveSelectedPublishSource(repository, "dotnet")).toThrow(
      "不存在"
    );
    repository.publishConfig.drafts = [draft("project-b"), draft("project-b")];
    expect(() => resolveSelectedPublishSource(repository, "dotnet")).toThrow(
      "不唯一"
    );
    repository.publishConfig.drafts = [draft("project-b")];
    repository.publishConfig.drafts[0].content.projectBinding = "project-a";
    expect(() => resolveSelectedPublishSource(repository, "dotnet")).toThrow(
      "作用域不一致"
    );
  });
  it("blocks missing revision references and initializes absent selections through backend", () => {
    const repository = repo();
    expect(() =>
      resolveSelectedPublishSource(
        {
          ...repository,
          publishConfig: {
            ...repository.publishConfig,
            selection: { kind: "revision", configurationId: "gone" },
          },
        },
        "npm"
      )
    ).toThrow("修订不存在");
    expect(
      resolveSelectedPublishSource(
        {
          ...repository,
          publishConfig: {
            ...repository.publishConfig,
            selection: null,
          },
        },
        "npm"
      )
    ).toEqual({ kind: "empty", providerId: "npm", projectBinding: null });
  });
  it("prepares stored content without waiting for legacy projectInfo or reading local form", async () => {
    prepare.mockResolvedValue(blocked);
    const input = props();
    renderHook(() => usePublishValidate(input));
    await waitFor(() => expect(prepare).toHaveBeenCalledOnce());
    expect(prepare.mock.calls[0][0].source.content.parameters).toEqual(
      parameters
    );
    expect(prepare.mock.calls[0][0].source.content.projectBinding).toBe(
      "project-b"
    );
  });
  it("does not prepare an unresolved selection", async () => {
    const input = props();
    input.selectedRepo!.publishConfig.drafts = [];
    const { result } = renderHook(() => usePublishValidate(input));
    expect(result.current.runtimePreparationError).toContain("草稿不存在");
    expect(await result.current.resolvePublishRequest()).toBeNull();
    expect(prepare).not.toHaveBeenCalled();
  });
  it("retires the previous result immediately when run inputs change and ignores old responses", async () => {
    let finish!: (result: PreparedPublishRuntime) => void;
    prepare.mockResolvedValueOnce(blocked).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const input = props();
    const { result, rerender } = renderHook(
      (value) => usePublishValidate(value),
      { initialProps: input }
    );
    await waitFor(() =>
      expect(result.current.preparedRuntime).toEqual(blocked)
    );
    rerender({ ...input, defaultOutputDir: "/new" });
    expect(result.current.preparedRuntime).toBeNull();
    await act(async () => finish(blocked));
    expect(result.current.preparedRuntime).toEqual(blocked);
  });
});
