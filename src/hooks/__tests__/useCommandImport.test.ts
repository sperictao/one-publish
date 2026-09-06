import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useCommandImport } from "@/hooks/useCommandImport";
import { useQuickCreateProfile } from "@/features/config/useQuickCreateProfile";

describe("command import into a publish configuration", () => {
  it("把解析结果送入新配置草稿，保存前不写配置", () => {
    const saveProfileToStore = vi.fn();
    const { result } = renderHook(() => {
      const quickCreate = useQuickCreateProfile({
        selectedRepoId: "repo",
        activeProviderId: "cargo",
        profileT: {},
        profiles: [],
        language: "zh",
        backendTemplates: [],
        refreshProfilesAfterMutation: vi.fn(),
        saveProfileToStore,
        updateProfile: vi.fn(),
        onProfileSaved: vi.fn(),
      });
      const commandImport = useCommandImport({
        activeProviderId: "cargo",
        appT: {},
        onImportDraft: (result) =>
          quickCreate.openQuickCreateProfileDialog({
            providerId: result.providerId,
            parameters: result.parameters,
          }),
      });
      return { ...quickCreate, ...commandImport };
    });
    act(() =>
      result.current.handleCommandImport({
        providerId: "cargo",
        parameters: { release: true },
        diagnostics: [],
      })
    );
    expect(result.current.quickCreateProfileOpen).toBe(true);
    expect(result.current.quickCreateProfileDraft).toEqual({
      providerId: "cargo",
      parameters: { release: true },
    });
    expect(result.current.quickCreateProfileName).toBe("");
    expect(saveProfileToStore).not.toHaveBeenCalled();
    expect(result.current.activeImportFeedback).toEqual({
      providerId: "cargo",
      diagnostics: [],
    });
  });

  it("诊断透出到反馈卡片，草稿仍打开", () => {
    const onImportDraft = vi.fn();
    const { result } = renderHook(() =>
      useCommandImport({
        activeProviderId: "cargo",
        appT: {},
        onImportDraft,
      })
    );
    const diagnostics = [
      {
        code: "command_import_unknown_flag",
        message: "unrecognized flag: --not-a-flag",
      },
    ];
    act(() =>
      result.current.handleCommandImport({
        providerId: "cargo",
        parameters: { release: true },
        diagnostics,
      })
    );
    expect(onImportDraft).toHaveBeenCalledWith({
      providerId: "cargo",
      parameters: { release: true },
      diagnostics,
    });
    expect(result.current.activeImportFeedback).toEqual({
      providerId: "cargo",
      diagnostics,
    });
  });
});
