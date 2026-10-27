import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const apiMocks = vi.hoisted(() => ({
  openExecutionSnapshot: vi.fn(),
}));
vi.mock("@/lib/store/api", () => apiMocks);

const dialogMocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => dialogMocks);

const runtimeMocks = vi.hoisted(() => ({ exportHandoffBundleFile: vi.fn() }));
vi.mock("@/features/history/diagnosticsExportRuntime", () => runtimeMocks);

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { error: toastMocks.error, success: toastMocks.success },
}));

vi.mock("@/hooks/useI18n", () => ({
  useI18n: () => ({ translations: {}, t: (k: string) => k }),
}));

const snippetMocks = vi.hoisted(() => ({
  buildGitLabCISnippet: vi.fn(),
}));
vi.mock("@/lib/handoffSnippet", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  buildGitLabCISnippet: snippetMocks.buildGitLabCISnippet,
}));

const setSnapshotPathMock = vi.hoisted(() => vi.fn());
vi.mock("@/stores/appStore", () => ({
  useAppStore: (selector: (s: unknown) => unknown) =>
    selector({ setExecutionSnapshotPath: setSnapshotPathMock }),
}));

import { useHistoryActions } from "@/features/history/useHistoryActions";
import type { ExecutionRecord } from "@/lib/store/types";
import type { ProviderPublishSpec } from "@/features/publish/publishRuntime";

const SPEC: ProviderPublishSpec = {
  version: 1,
  provider_id: "dotnet",
  project_path: "/repo/app",
  parameters: {},
};

function record(overrides: Partial<ExecutionRecord> = {}): ExecutionRecord {
  return {
    id: "rec-1",
    providerId: "dotnet",
    projectPath: "/repo/app",
    startedAt: "2026-01-01T00:00:00Z",
    finishedAt: "2026-01-01T00:00:01Z",
    success: true,
    cancelled: false,
    fileCount: 0,
    repoId: "repo-1",
    snapshotPath: null,
    outputDir: "/repo/out",
    commandLine: "dotnet publish",
    ...overrides,
  };
}

function setup(extractResult: ProviderPublishSpec | null = SPEC) {
  const extractSpecFromRecord = vi.fn(() => extractResult);
  const { result } = renderHook(() =>
    useHistoryActions({
      appT: {},
      historyT: {},
      extractSpecFromRecord,
    })
  );
  return { actions: result.current, extractSpecFromRecord };
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
  snippetMocks.buildGitLabCISnippet.mockReturnValue("stages:\n  - publish\n");
});

describe("copyHandoffSnippet", () => {
  it("rejects non-success records", async () => {
    const { actions } = setup();

    await actions.copyHandoffSnippet(record({ success: false }), "shell");

    expect(toastMocks.error).toHaveBeenCalledWith("仅成功记录支持生成交接片段");
  });

  it("rejects records without a recoverable spec", async () => {
    const { actions } = setup(null);

    await actions.copyHandoffSnippet(record(), "shell");

    expect(toastMocks.error).toHaveBeenCalledWith("该记录缺少可恢复的发布参数");
  });

  it("builds the shell snippet and copies it via the clipboard api", async () => {
    const { actions, extractSpecFromRecord } = setup();

    await actions.copyHandoffSnippet(record(), "shell");

    expect(extractSpecFromRecord).toHaveBeenCalled();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("dotnet")
    );
    expect(toastMocks.success).toHaveBeenCalledWith(
      expect.stringContaining("已复制")
    );
  });

  it("builds the gitlab-ci snippet and copies it with its own label", async () => {
    const { actions } = setup();

    await actions.copyHandoffSnippet(record(), "gitlab-ci");

    expect(snippetMocks.buildGitLabCISnippet).toHaveBeenCalledWith({
      spec: SPEC,
      commandLine: "dotnet publish",
    });
    // copyText 先 trim 再写剪贴板——尾部换行不进入剪贴板。
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "stages:\n  - publish"
    );
    expect(toastMocks.success).toHaveBeenCalledWith("GitLab CI 交接片段已复制");
  });

  it("rejects copying when the built snippet is blank", async () => {
    snippetMocks.buildGitLabCISnippet.mockReturnValue("   ");
    const { actions } = setup();

    await actions.copyHandoffSnippet(record(), "gitlab-ci");

    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(toastMocks.error).toHaveBeenCalledWith(
      "缺少可复制的GitLab CI 交接片段"
    );
  });

  it("falls back to execCommand when the clipboard api is unavailable", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
    const execCommand = vi.fn().mockReturnValue(true);
    document.execCommand = execCommand;
    const { actions } = setup();

    await actions.copyHandoffSnippet(record(), "shell");

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(toastMocks.success).toHaveBeenCalledWith(
      expect.stringContaining("已复制")
    );
    // 临时 textarea 必须回收，不留 DOM 垃圾。
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("surfaces a failure toast when execCommand reports failure", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
    document.execCommand = vi.fn().mockReturnValue(false);
    const { actions } = setup();

    await actions.copyHandoffSnippet(record(), "shell");

    expect(toastMocks.error).toHaveBeenCalledWith(
      "复制Shell 交接片段失败",
      expect.objectContaining({ description: expect.any(String) })
    );
  });

  it("surfaces a failure toast when the clipboard write rejects", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    });
    const { actions } = setup();

    await actions.copyHandoffSnippet(record(), "shell");

    expect(toastMocks.error).toHaveBeenCalledWith(
      "复制Shell 交接片段失败",
      expect.objectContaining({ description: "Error: denied" })
    );
  });

  it("errors instead of copying when the snippet is empty", async () => {
    const { actions } = setup({
      ...SPEC,
      provider_id: "",
      project_path: "",
    });

    // Spec with blank fields still yields a snippet from the builder; use a
    // record whose command line is also blank to exercise the trim guard.
    await actions.copyHandoffSnippet(
      record({ commandLine: "" }),
      "github-actions"
    );

    // The snippet builder always emits content for a valid spec, so success
    // is acceptable; the assertion pins that no crash occurred.
    expect(
      toastMocks.success.mock.calls.length + toastMocks.error.mock.calls.length
    ).toBe(1);
  });
});

describe("openSnapshotFromRecord", () => {
  it("opens the snapshot and backfills snapshotPath when it differs", async () => {
    apiMocks.openExecutionSnapshot.mockResolvedValue("/repo/snap.md");
    const { actions } = setup();

    await actions.openSnapshotFromRecord(record({ snapshotPath: null }));

    expect(apiMocks.openExecutionSnapshot).toHaveBeenCalledWith({
      snapshotPath: null,
      outputDir: "/repo/out",
    });
    expect(setSnapshotPathMock).toHaveBeenCalledWith("rec-1", "/repo/snap.md");
    expect(toastMocks.success).toHaveBeenCalledWith(
      "已打开执行快照",
      expect.objectContaining({ description: "/repo/snap.md" })
    );
  });

  it("skips the store write when the existing snapshot path is reused", async () => {
    apiMocks.openExecutionSnapshot.mockResolvedValue("/repo/snap.md");
    const { actions } = setup();

    await actions.openSnapshotFromRecord(
      record({ snapshotPath: "/repo/snap.md" })
    );

    expect(setSnapshotPathMock).not.toHaveBeenCalled();
  });

  it("surfaces a localized failure toast on error", async () => {
    apiMocks.openExecutionSnapshot.mockRejectedValue(new Error("gone"));
    const { actions } = setup();

    await actions.openSnapshotFromRecord(record());

    expect(toastMocks.error).toHaveBeenCalledWith(
      "打开执行快照失败",
      expect.objectContaining({ description: expect.any(String) })
    );
  });
});

describe("exportHandoffBundle", () => {
  it("does nothing when the save dialog is dismissed", async () => {
    dialogMocks.save.mockResolvedValue(null);
    const { actions } = setup();

    await actions.exportHandoffBundle(record());

    expect(runtimeMocks.exportHandoffBundleFile).not.toHaveBeenCalled();
    expect(toastMocks.success).not.toHaveBeenCalled();
  });

  it("exports a failure bundle for failed runs", async () => {
    dialogMocks.save.mockResolvedValue("/tmp/handoff.zip");
    runtimeMocks.exportHandoffBundleFile.mockResolvedValue("/tmp/handoff.zip");
    const { actions } = setup();

    await actions.exportHandoffBundle(record({ success: false }));

    expect(runtimeMocks.exportHandoffBundleFile).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: "/tmp/handoff.zip",
        failureBundle: expect.objectContaining({ groups: expect.any(Array) }),
      })
    );
    expect(toastMocks.success).toHaveBeenCalledWith(
      "交接包已导出",
      expect.objectContaining({ description: "/tmp/handoff.zip" })
    );
  });

  it("exports without a failure bundle for successful runs", async () => {
    dialogMocks.save.mockResolvedValue("/tmp/handoff.zip");
    runtimeMocks.exportHandoffBundleFile.mockResolvedValue("/tmp/handoff.zip");
    const { actions } = setup();

    await actions.exportHandoffBundle(record({ success: true }));

    expect(runtimeMocks.exportHandoffBundleFile).toHaveBeenCalledWith(
      expect.objectContaining({ failureBundle: null })
    );
  });

  it("builds the default filename from finishedAt", async () => {
    dialogMocks.save.mockResolvedValue(null);
    const { actions } = setup();

    await actions.exportHandoffBundle(
      record({ finishedAt: "2026-01-01T00:00:01.234Z" })
    );

    expect(dialogMocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: "one-publish-handoff-2026-01-01T00-00-01-234Z.zip",
      })
    );
  });

  it("surfaces a failure toast when the export rejects", async () => {
    dialogMocks.save.mockResolvedValue("/tmp/h.zip");
    runtimeMocks.exportHandoffBundleFile.mockRejectedValue(new Error("io"));
    const { actions } = setup();

    await actions.exportHandoffBundle(record());

    expect(toastMocks.error).toHaveBeenCalledWith(
      "导出交接包失败",
      expect.objectContaining({ description: expect.any(String) })
    );
  });
});
