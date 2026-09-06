import { describe, expect, it } from "vitest";

import {
  createFailedPublishTransactionResult,
  createPublishTransactionContext,
  shouldRecordRecentConfig,
} from "@/features/publish/publishTransaction";
import type { ProviderPublishSpec } from "@/features/publish/publishRuntime";

const spec: ProviderPublishSpec = {
  version: 1,
  provider_id: "dotnet",
  project_path: "/repo/App.csproj",
  parameters: {},
};

describe("publishTransaction", () => {
  it("creates a transaction context from explicit run options", () => {
    const transaction = createPublishTransactionContext({
      selectedRepoId: "repo-1",
      startedAt: "2026-05-23T00:00:00.000Z",
      options: {
        repoId: "repo-2",
        recentConfigKey: "pubxml:Folder",
        openOutputDirOnSuccess: true,
        restoreWindowOnFailure: true,
        feedbackMode: "system",
        trayStatusEffect: true,
      },
    });

    expect(transaction).toEqual({
      repoId: "repo-2",
      recentConfigKey: "pubxml:Folder",
      openOutputDirOnSuccess: true,
      restoreWindowOnFailure: true,
      feedbackMode: "system",
      trayStatusEffect: true,
      startedAt: "2026-05-23T00:00:00.000Z",
    });
  });

  it("falls back to the selected repo and default publish effects", () => {
    expect(
      createPublishTransactionContext({
        selectedRepoId: "repo-1",
        startedAt: "2026-05-23T00:00:00.000Z",
      })
    ).toMatchObject({
      repoId: "repo-1",
      recentConfigKey: null,
      openOutputDirOnSuccess: false,
      restoreWindowOnFailure: false,
      feedbackMode: "toast",
      trayStatusEffect: false,
    });
  });

  it("records recent config only when the transaction has a repo and key", () => {
    expect(
      shouldRecordRecentConfig({
        repoId: "repo-1",
        recentConfigKey: "userprofile:alpha",
      })
    ).toBe(true);
    expect(
      shouldRecordRecentConfig({
        repoId: null,
        recentConfigKey: "userprofile:alpha",
      })
    ).toBe(false);
    expect(
      shouldRecordRecentConfig({
        repoId: "repo-1",
        recentConfigKey: null,
      })
    ).toBe(false);
  });

  it("normalizes failed transaction result from output context", () => {
    const result = createFailedPublishTransactionResult({
      spec,
      errorMessage: "发布失败，退出代码: Some(1)",
      outputLog:
        "$ dotnet publish\nCSC : error CS0246: The type or namespace name 'Foo' could not be found",
    });

    expect(result.success).toBe(false);
    expect(result.provider_id).toBe("dotnet");
    expect(result.error).toContain("CS0246");
  });
});
