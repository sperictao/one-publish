import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type {
  ScopedPublishDraft,
  PreparedPublishRuntime,
} from "@/generated/tauri-contracts";
import en from "@/i18n/en.json";
import zh from "@/i18n/zh.json";
import {
  describePublishSourceSelectionError,
  PublishSourceSelectionError,
  resolveSelectedPublishSource,
  usePublishValidate,
  type UsePublishValidateParams,
} from "../usePublishValidate";
import en from "@/i18n/en.json";
import zh from "@/i18n/zh.json";

const prepare = vi.hoisted(() => vi.fn());
const i18n = vi.hoisted(() => ({
  translations: {} as Record<string, unknown>,
}));
vi.mock("@/hooks/useI18n", () => ({
  useI18n: () => ({ translations: i18n.translations }),
}));
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
      new PublishSourceSelectionError("draftUnresolved")
    );
    repository.publishConfig.drafts = [draft("project-b"), draft("project-b")];
    expect(() => resolveSelectedPublishSource(repository, "dotnet")).toThrow(
      new PublishSourceSelectionError("draftUnresolved")
    );
    repository.publishConfig.drafts = [draft("project-b")];
    repository.publishConfig.drafts[0].content.projectBinding = "project-a";
    expect(() => resolveSelectedPublishSource(repository, "dotnet")).toThrow(
      new PublishSourceSelectionError("draftScopeMismatch")
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
    ).toThrow(new PublishSourceSelectionError("revisionMissing"));
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
  it("defers runtime preparation on Windows until publish is explicitly requested", async () => {
    const userAgent = vi
      .spyOn(window.navigator, "userAgent", "get")
      .mockReturnValue("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    prepare.mockResolvedValue(blocked);
    const input = props();

    try {
      const { result } = renderHook(() => usePublishValidate(input));
      await act(async () => Promise.resolve());
      expect(prepare).not.toHaveBeenCalled();
      expect(result.current.getPublishStartBlocker()).toBeNull();

      await act(async () => {
        await result.current.resolvePublishRequest();
      });

      expect(prepare).toHaveBeenCalledOnce();
      expect(result.current.preparedRuntime).toEqual(blocked);
    } finally {
      userAgent.mockRestore();
    }
  });
  it("does not prepare an unresolved selection", async () => {
    const input = props();
    input.selectedRepo!.publishConfig.drafts = [];
    const { result } = renderHook(() => usePublishValidate(input));
    expect(result.current.runtimePreparationError).toContain("草稿不存在");
    expect(await result.current.resolvePublishRequest()).toBeNull();
    expect(prepare).not.toHaveBeenCalled();
  });
  it("localizes unresolved selections with the current UI language", () => {
    const input = props();
    input.selectedRepo!.publishConfig.drafts = [];
    input.appT = en.app;
    const { result, rerender } = renderHook(
      (params: UsePublishValidateParams) => usePublishValidate(params),
      { initialProps: input }
    );
    expect(result.current.runtimePreparationError).toBe(
      en.app.publishSourceDraftUnresolved
    );

    rerender({ ...input, appT: zh.app });
    expect(result.current.runtimePreparationError).toBe(
      zh.app.publishSourceDraftUnresolved
    );
    expect(prepare).not.toHaveBeenCalled();

    expect(
      describePublishSourceSelectionError(
        new PublishSourceSelectionError("revisionMissing"),
        en.app
      )
    ).toBe(en.app.publishSourceRevisionMissing);
    expect(
      describePublishSourceSelectionError(
        new PublishSourceSelectionError("draftScopeMismatch"),
        en.app
      )
    ).toBe(en.app.publishSourceDraftScopeMismatch);
    expect(
      describePublishSourceSelectionError({ message: "raw failure" }, en.app)
    ).toBe("raw failure");
  });
  it("does not prepare again when only the UI language changes", async () => {
    prepare.mockResolvedValue(blocked);
    const input = { ...props(), appT: en.app };
    const { rerender } = renderHook(
      (params: UsePublishValidateParams) => usePublishValidate(params),
      { initialProps: input }
    );
    await waitFor(() => expect(prepare).toHaveBeenCalledOnce());

    rerender({ ...input, appT: zh.app });
    await act(async () => Promise.resolve());

    expect(prepare).toHaveBeenCalledOnce();
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

describe("runtime preparation error localization", () => {
  beforeEach(() => {
    prepare.mockReset();
    i18n.translations = en;
  });

  it("localizes the invoke error at render time and follows language switches", async () => {
    prepare.mockRejectedValue({
      kind: "repository",
      message: "selected repository is not a directory",
      details: "/repo",
      code: "publish_runtime_repository_unavailable",
    });
    const input = props();
    const { result, rerender } = renderHook(() => usePublishValidate(input));

    await waitFor(() =>
      expect(result.current.runtimePreparationError).toBe(
        "Couldn't resolve the selected repository path. Make sure the repository directory exists. | /repo"
      )
    );
    const runPublishPreflight = result.current.runPublishPreflight;

    i18n.translations = zh;
    rerender();

    expect(result.current.runtimePreparationError).toBe(
      "无法解析所选仓库路径，请确认仓库目录存在 | /repo"
    );
    // 预检管线进入 runPublishSpec（托盘监听 effect 的依赖），翻译切换不得重建。
    expect(result.current.runPublishPreflight).toBe(runPublishPreflight);
    expect(prepare).toHaveBeenCalledOnce();
  });
});
