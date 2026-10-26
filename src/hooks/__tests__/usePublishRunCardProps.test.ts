import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { usePublishRunCardProps } from "@/hooks/usePublishRunCardProps";
import type { Repository } from "@/lib/store/types";
import type { PreparedPublishRuntime } from "@/generated/tauri-contracts";

function repo(): Repository {
  return {
    id: "repo-1",
    name: "app",
    path: "/repo/app",
    currentBranch: "main",
    branches: [],
    publishConfig: {
      drafts: [],
      profiles: [],
      bindings: [],
      appliedBundles: [],
    },
  };
}

function blockedRuntime(
  diagnostics: { code: string; message: string }[],
  accessStatus: "denied" | "granted" = "denied"
): PreparedPublishRuntime {
  return {
    status: "blocked",
    diagnostics,
    outputPreflight: { outputDir: "/out", accessStatus },
  };
}

function params(overrides: Record<string, unknown> = {}) {
  return {
    outputLog: "",
    getOutputLogSnapshot: () => "",
    publishResult: null,
    appT: {},
    publishT: {},
    configT: {},
    isRefreshing: false,
    selectedRepo: repo(),
    publishPreviewCommand: "dotnet publish",
    preparedRuntime: null,
    activeRuntime: null,
    runtimeResult: null,
    runtimePreparationError: null,
    requiresPreparedRuntime: false,
    isPublishing: false,
    isCancellingPublish: false,
    startPublish: vi.fn(),
    cancelPublish: vi.fn(),
    artifactActionState: { packageResult: null, signResult: null },
    onArtifactStateChange: vi.fn(),
    onOpenReleaseChecklist: vi.fn(),
    ...overrides,
  } as Parameters<typeof usePublishRunCardProps>[0];
}

describe("usePublishRunCardProps", () => {
  it("returns null publishActions when no repo is selected", () => {
    const { result } = renderHook(() =>
      usePublishRunCardProps(params({ selectedRepo: null }))
    );

    expect(result.current.publishActions).toBeNull();
  });

  it("enables start when a repo is selected and no runtime is required", () => {
    const { result } = renderHook(() => usePublishRunCardProps(params()));

    expect(result.current.publishActions).toMatchObject({
      publishCommand: "dotnet publish",
      startDisabled: false,
      isPublishing: false,
    });
  });

  it("applies translation labels with fallbacks", () => {
    const { result } = renderHook(() =>
      usePublishRunCardProps(
        params({
          publishT: { command: "Command:" },
          configT: { execute: "Run" },
        })
      )
    );

    expect(result.current.publishActions).toMatchObject({
      publishCommandLabel: "Command:",
      startLabel: "Run",
      publishingLabel: "发布中...",
      cancelLabel: "取消发布",
    });
  });

  it("keeps start enabled when the required runtime is ready", () => {
    const preparedRuntime: PreparedPublishRuntime = {
      status: "ready",
    } as PreparedPublishRuntime;
    const { result } = renderHook(() =>
      usePublishRunCardProps(
        params({ requiresPreparedRuntime: true, preparedRuntime })
      )
    );

    expect(result.current.publishActions?.startDisabled).toBe(false);
  });

  it("disables start when the required runtime is blocked", () => {
    const { result } = renderHook(() =>
      usePublishRunCardProps(
        params({
          requiresPreparedRuntime: true,
          preparedRuntime: blockedRuntime([
            { code: "other_error", message: "nope" },
          ]),
        })
      )
    );

    expect(result.current.publishActions?.startDisabled).toBe(true);
  });

  it("keeps start enabled when blocked solely by denied output access", () => {
    const { result } = renderHook(() =>
      usePublishRunCardProps(
        params({
          requiresPreparedRuntime: true,
          preparedRuntime: blockedRuntime([
            { code: "publish_output_access_denied", message: "denied" },
            { code: "publish_output_access_denied", message: "denied" },
          ]),
        })
      )
    );

    expect(result.current.publishActions?.startDisabled).toBe(false);
  });

  it("disables start when denied access mixes with other diagnostics", () => {
    const { result } = renderHook(() =>
      usePublishRunCardProps(
        params({
          requiresPreparedRuntime: true,
          preparedRuntime: blockedRuntime([
            { code: "publish_output_access_denied", message: "denied" },
            { code: "other_error", message: "nope" },
          ]),
        })
      )
    );

    expect(result.current.publishActions?.startDisabled).toBe(true);
  });
});
