import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import en from "@/i18n/en.json";
import type { ConfigProfile } from "@/lib/store/types";

const mocks = vi.hoisted(() => ({ toastError: vi.fn() }));

vi.mock("@/hooks/useI18n", async () => {
  const translations = (await import("@/i18n/en.json")).default;
  return { useI18n: () => ({ translations }) };
});

vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));

import { useProfileOrdering } from "@/features/config/useProfileOrdering";

describe("useProfileOrdering", () => {
  it("排序保存失败时重新加载并按界面语言提示", async () => {
    const onReorderFailed = vi.fn().mockResolvedValue(undefined);
    const reorderProfilesFn = vi.fn().mockRejectedValue({
      kind: "validation",
      message: "排序目标与当前配置列表不一致",
      code: "profile_order_mismatch",
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { result } = renderHook(() =>
      useProfileOrdering({
        selectedRepoId: "repo-1",
        onOptimisticUpdate: vi.fn(),
        onReorderFailed,
        reorderProfilesFn,
        profileT: en.profiles,
      })
    );

    act(() => {
      result.current.reorderVisibleProfiles([
        { id: "profile-1", profileGroup: null } as unknown as ConfigProfile,
      ]);
    });

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Failed to update profile",
        {
          description:
            "The new order doesn't match the current profile list. Refresh and try again.",
        }
      )
    );
    expect(onReorderFailed).toHaveBeenCalledOnce();
  });
});
