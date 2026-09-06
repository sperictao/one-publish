import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useQuickCreateProfile,
  type UseQuickCreateProfileParams,
} from "@/features/config/useQuickCreateProfile";
import type { ResolvedPublishSource } from "@/generated/tauri-contracts";

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), error: vi.fn() }));
vi.mock("@/features/publish/publishRuntime", () => ({
  resolvePublishSource: mocks.resolve,
}));
vi.mock("sonner", () => ({ toast: { error: mocks.error, success: vi.fn() } }));

function deferred() {
  let resolve!: (value: ResolvedPublishSource) => void;
  const promise = new Promise<ResolvedPublishSource>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function resolved(
  parameters: Record<string, import("@/generated/tauri-contracts").JsonValue>
): ResolvedPublishSource {
  return {
    draft: {
      content: {
        providerId: "cargo",
        parameters,
        contractVersion: 1,
        providerVersion: "1",
        settingsVersion: 1,
        composition: {
          executionBackend: {
            adapterId: "local-execution",
            settingsVersion: 1,
            settings: {},
            credentials: {},
          },
          artifactStore: {
            adapterId: "temporary-artifact-store",
            settingsVersion: 1,
            settings: {},
            credentials: {},
          },
          artifactProcessors: [],
          deliveryRoutes: [],
        },
      },
      origin: { kind: "template", templateId: "release" },
    },
    diagnostics: [],
  } as ResolvedPublishSource;
}
function props(): UseQuickCreateProfileParams {
  return {
    selectedRepoId: "repo-a",
    activeProviderId: "cargo",
    projectBinding: "cargo:workspace",
    backendTemplates: [
      { id: "release", name: "Release", description: "Optimized" },
    ],
    profileT: {},
    profiles: [],
    language: "zh",
    refreshProfilesAfterMutation: vi.fn(),
    saveProfileToStore: vi.fn(),
    updateProfile: vi.fn(),
    onProfileSaved: vi.fn(),
  };
}

describe("quick create backend templates", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves the selected provider template and preserves all returned parameters", async () => {
    const parameters = {
      release: false,
      unset: null,
      features: "",
      extra: { keep: false },
    };
    mocks.resolve.mockResolvedValue(resolved(parameters));
    const { result } = renderHook(() => useQuickCreateProfile(props()));
    act(() => result.current.openQuickCreateProfileDialog());
    expect(
      result.current.quickCreateTemplateOptions.map((item) => item.id)
    ).toEqual(["custom", "release"]);
    await act(async () => {
      await result.current.applyQuickCreateTemplate("release");
    });
    expect(mocks.resolve).toHaveBeenCalledWith("repo-a", {
      kind: "template",
      providerId: "cargo",
      templateId: "release",
      projectBinding: "cargo:workspace",
    });
    expect(result.current.quickCreateProfileDraft).toEqual({
      providerId: "cargo",
      parameters,
    });
    expect(result.current.quickCreateTemplateId).toBe("release");
    act(() => {
      void result.current.applyQuickCreateTemplate("custom");
    });
    expect(result.current.quickCreateProfileDraft).toEqual({
      providerId: "cargo",
      parameters: {},
    });
  });

  it("blocks save until template resolution completes", async () => {
    const pending = deferred();
    mocks.resolve.mockReturnValue(pending.promise);
    const input = props();
    const { result } = renderHook(() => useQuickCreateProfile(input));
    act(() => {
      result.current.openQuickCreateProfileDialog();
      result.current.setQuickCreateProfileName("Build");
    });
    act(() => {
      void result.current.applyQuickCreateTemplate("release");
    });
    expect(result.current.quickCreateProfileSaving).toBe(true);
    await act(async () => {
      await result.current.handleQuickCreateProfileSave();
    });
    expect(input.saveProfileToStore).not.toHaveBeenCalled();
    await act(async () => pending.resolve(resolved({ release: true })));
    expect(result.current.quickCreateProfileSaving).toBe(false);
  });

  it.each(["edit", "close", "repo", "provider", "custom"])(
    "ignores a late template response after %s",
    async (action) => {
      const pending = deferred();
      mocks.resolve.mockReturnValue(pending.promise);
      const input = props();
      const { result, rerender } = renderHook(useQuickCreateProfile, {
        initialProps: input,
      });
      act(() => result.current.openQuickCreateProfileDialog());
      act(() => {
        void result.current.applyQuickCreateTemplate("release");
      });
      act(() => {
        if (action === "edit")
          result.current.updateQuickCreateProfileParameter("release", false);
        if (action === "close")
          result.current.handleQuickCreateProfileOpenChange(false);
        if (action === "custom")
          result.current.applyQuickCreateTemplate("custom");
      });
      if (action === "repo") rerender({ ...input, selectedRepoId: "repo-b" });
      if (action === "provider")
        rerender({ ...input, activeProviderId: "dotnet" });
      const expected = result.current.quickCreateProfileDraft;
      await act(async () => pending.resolve(resolved({ release: true })));
      expect(result.current.quickCreateProfileDraft).toEqual(expected);
      expect(result.current.quickCreateProfileSaving).toBe(false);
    }
  );

  it("keeps the newest template when requests finish out of order", async () => {
    const older = deferred();
    const newer = deferred();
    mocks.resolve
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    const { result } = renderHook(() => useQuickCreateProfile(props()));
    act(() => result.current.openQuickCreateProfileDialog());
    act(() => {
      void result.current.applyQuickCreateTemplate("release");
    });
    act(() => {
      void result.current.applyQuickCreateTemplate("debug");
    });
    await act(async () => newer.resolve(resolved({ release: false })));
    await act(async () => older.resolve(resolved({ release: true })));
    expect(result.current.quickCreateProfileDraft.parameters).toEqual({
      release: false,
    });
    expect(result.current.quickCreateTemplateId).toBe("debug");
  });
});
