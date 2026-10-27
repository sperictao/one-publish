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
vi.mock("@/hooks/useI18n", async () => {
  const translations = (await import("@/i18n/en.json")).default;
  return { useI18n: () => ({ translations }) };
});

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

describe("quick create invoke failures", () => {
  beforeEach(() => vi.clearAllMocks());

  it("localizes template resolution failures by error code", async () => {
    mocks.resolve.mockRejectedValue({
      kind: "validation",
      message: "未找到仓库",
      details: "repo-a",
      code: "repository_not_found",
    });
    const { result } = renderHook(() => useQuickCreateProfile(props()));
    act(() => result.current.openQuickCreateProfileDialog());

    await act(async () => {
      await result.current.applyQuickCreateTemplate("release");
    });

    expect(mocks.error).toHaveBeenCalledWith("Repository not found. | repo-a");
    expect(result.current.quickCreateTemplateId).toBe("custom");
  });

  it("localizes save failures by error code", async () => {
    const input = props();
    vi.mocked(input.saveProfileToStore).mockRejectedValue({
      kind: "validation",
      message: "配置文件已存在",
      details: "Build",
      code: "profile_exists",
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useQuickCreateProfile(input));
    act(() => {
      result.current.openQuickCreateProfileDialog();
      result.current.setQuickCreateProfileName("Build");
    });

    await act(async () => {
      await result.current.handleQuickCreateProfileSave();
    });

    expect(mocks.error).toHaveBeenCalledWith(
      "A configuration profile with this name already exists. | Build"
    );
  });
});

describe("quick create dialog loading and save", () => {
  beforeEach(() => vi.clearAllMocks());

  const profile = (overrides = {}) =>
    ({
      id: "p-1",
      name: "release-cfg",
      providerId: "cargo",
      profileGroup: "backend",
      parameters: { profile: "release" },
      isSystemDefault: false,
      isDraft: false,
      currentRevisionId: "r1",
      revisions: [],
      deletedAt: null,
      blockedReason: null,
      createdAt: "2025-01-01",
      ...overrides,
    }) as never;

  it("refuses to edit a system-default profile", () => {
    const { result } = renderHook(() => useQuickCreateProfile(props()));

    act(() => {
      result.current.openQuickEditProfileDialog(
        profile({ isSystemDefault: true })
      );
    });

    expect(result.current.quickCreateProfileOpen).toBe(false);
    expect(result.current.isQuickCreateEditing).toBe(false);
  });

  it("loads an editable profile into the dialog as a custom-template draft", () => {
    const { result } = renderHook(() => useQuickCreateProfile(props()));

    act(() => {
      result.current.openQuickEditProfileDialog(profile());
    });

    expect(result.current.quickCreateProfileOpen).toBe(true);
    expect(result.current.isQuickCreateEditing).toBe(true);
    expect(result.current.isQuickCreateViewing).toBe(false);
    expect(result.current.quickCreateProfileName).toBe("release-cfg");
    expect(result.current.quickCreateProfileGroup).toBe("backend");
    expect(result.current.quickCreateProfileDraft.parameters).toEqual({
      profile: "release",
    });
  });

  it("opens view mode and normalizes a blank group to the default sentinel", () => {
    const { result } = renderHook(() => useQuickCreateProfile(props()));

    act(() => {
      result.current.openQuickViewProfileDialog(
        profile({ profileGroup: "   " })
      );
    });

    expect(result.current.isQuickCreateViewing).toBe(true);
    expect(result.current.quickCreateProfileGroup).not.toBe("");
  });

  it("seeds the dialog with a provided draft", () => {
    const { result } = renderHook(() => useQuickCreateProfile(props()));

    act(() => {
      result.current.openQuickCreateProfileDialog({
        providerId: "cargo",
        parameters: { seeded: "yes" },
      });
    });

    expect(result.current.quickCreateProfileDraft.parameters).toEqual({
      seeded: "yes",
    });
  });

  it("dedupes and sorts profile groups, excluding sentinel values", () => {
    const withGroups = props();
    withGroups.profiles = [
      profile({ profileGroup: "zeta" }),
      profile({ profileGroup: "alpha" }),
      profile({ profileGroup: "zeta" }),
      profile({ profileGroup: "" }),
    ];
    const { result } = renderHook(() => useQuickCreateProfile(withGroups));

    expect(result.current.quickCreateProfileGroupOptions).toEqual([
      "alpha",
      "zeta",
    ]);
  });

  it("resets the draft when the custom template is selected", async () => {
    const { result } = renderHook(() => useQuickCreateProfile(props()));
    act(() => {
      result.current.openQuickCreateProfileDialog({
        providerId: "cargo",
        parameters: { stale: "x" },
      });
    });

    await act(async () => {
      await result.current.applyQuickCreateTemplate("custom");
    });

    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it("skips template resolution while the dialog is closed", async () => {
    const { result } = renderHook(() => useQuickCreateProfile(props()));

    await act(async () => {
      await result.current.applyQuickCreateTemplate("release");
    });

    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it("treats blocked resolution and non-object parameters as failures", async () => {
    const { result } = renderHook(() => useQuickCreateProfile(props()));
    act(() => {
      result.current.openQuickCreateProfileDialog();
    });

    const blocked = resolved({});
    blocked.blockedReason = "draft blocked";
    mocks.resolve.mockResolvedValueOnce(blocked);
    await act(async () => {
      await result.current.applyQuickCreateTemplate("release");
    });
    expect(mocks.error).toHaveBeenCalledWith(
      expect.stringContaining("draft blocked")
    );

    const nonObject = resolved({});
    nonObject.draft.content.parameters = ["not-object"];
    mocks.resolve.mockResolvedValueOnce(nonObject);
    await act(async () => {
      await result.current.applyQuickCreateTemplate("release");
    });
    expect(mocks.error).toHaveBeenCalledWith(
      expect.stringContaining("模板参数必须是对象")
    );
  });

  it("requires a profile name before saving", async () => {
    const saveProfileToStore = vi.fn();
    const { result } = renderHook(() =>
      useQuickCreateProfile({ ...props(), saveProfileToStore })
    );
    act(() => {
      result.current.openQuickCreateProfileDialog();
      result.current.setQuickCreateProfileName("   ");
    });

    await act(async () => {
      await result.current.handleQuickCreateProfileSave();
    });

    expect(saveProfileToStore).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith("请输入配置文件名称");
  });

  it("requires a custom group name when the custom group is chosen", async () => {
    const saveProfileToStore = vi.fn();
    const { result } = renderHook(() =>
      useQuickCreateProfile({ ...props(), saveProfileToStore })
    );
    act(() => {
      result.current.openQuickCreateProfileDialog();
      result.current.setQuickCreateProfileName("cfg");
      result.current.setQuickCreateProfileGroup("__custom__");
      result.current.setQuickCreateProfileCustomGroup("   ");
    });

    await act(async () => {
      await result.current.handleQuickCreateProfileSave();
    });

    expect(saveProfileToStore).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith("请输入发布配置组名称");
  });

  it("updates the loaded profile through updateProfile when editing", async () => {
    const updateProfile = vi.fn().mockResolvedValue({
      repositories: [
        {
          id: "repo-a",
          publishConfig: { profiles: [profile()] },
        },
      ],
    });
    const refreshProfilesAfterMutation = vi.fn().mockResolvedValue([profile()]);
    const onProfileSaved = vi.fn();
    const { result } = renderHook(() =>
      useQuickCreateProfile({
        ...props(),
        updateProfile,
        refreshProfilesAfterMutation,
        onProfileSaved,
      })
    );
    act(() => {
      result.current.openQuickEditProfileDialog(profile());
      result.current.setQuickCreateProfileName("renamed-cfg");
    });

    await act(async () => {
      await result.current.handleQuickCreateProfileSave();
    });

    expect(updateProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        repoId: "repo-a",
        profileId: "p-1",
        name: "renamed-cfg",
      })
    );
    expect(onProfileSaved).toHaveBeenCalledWith(
      expect.objectContaining({ id: "p-1" })
    );
  });

  it("surfaces a save failure when the saved profile cannot be found", async () => {
    const saveProfileToStore = vi.fn().mockResolvedValue({ repositories: [] });
    const refreshProfilesAfterMutation = vi.fn().mockResolvedValue([]);
    const { result } = renderHook(() =>
      useQuickCreateProfile({
        ...props(),
        saveProfileToStore,
        refreshProfilesAfterMutation,
      })
    );
    act(() => {
      result.current.openQuickCreateProfileDialog();
      result.current.setQuickCreateProfileName("ghost");
    });

    await act(async () => {
      await result.current.handleQuickCreateProfileSave();
    });

    expect(mocks.error).toHaveBeenCalledWith(
      expect.stringContaining("保存后未找到配置身份")
    );
  });

  it("joins diagnostics into the failure when no blockedReason is given", async () => {
    const { result } = renderHook(() => useQuickCreateProfile(props()));
    act(() => {
      result.current.openQuickCreateProfileDialog();
    });
    mocks.resolve.mockResolvedValueOnce({
      draft: { content: { providerId: "cargo", parameters: {} } },
      diagnostics: [{ message: "diag one" }, { message: "diag two" }],
    } as ResolvedPublishSource);

    await act(async () => {
      await result.current.applyQuickCreateTemplate("release");
    });

    expect(mocks.error).toHaveBeenCalledWith(
      expect.stringContaining("diag one")
    );
  });

  it("saves a new profile and resolves it by name", async () => {
    const saved = profile({ id: "p-new", name: "fresh-cfg" });
    const saveProfileToStore = vi.fn().mockResolvedValue({
      repositories: [{ id: "repo-a", publishConfig: { profiles: [saved] } }],
    });
    const refreshProfilesAfterMutation = vi.fn().mockResolvedValue([saved]);
    const onProfileSaved = vi.fn();
    const { result } = renderHook(() =>
      useQuickCreateProfile({
        ...props(),
        saveProfileToStore,
        refreshProfilesAfterMutation,
        onProfileSaved,
      })
    );
    act(() => {
      result.current.openQuickCreateProfileDialog();
      result.current.setQuickCreateProfileName("fresh-cfg");
    });

    await act(async () => {
      await result.current.handleQuickCreateProfileSave();
    });

    expect(saveProfileToStore).toHaveBeenCalledWith(
      expect.objectContaining({ repoId: "repo-a", name: "fresh-cfg" })
    );
    expect(onProfileSaved).toHaveBeenCalledWith(
      expect.objectContaining({ id: "p-new" })
    );
    expect(result.current.quickCreateProfileOpen).toBe(false);
  });
});
