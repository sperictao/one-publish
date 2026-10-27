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
  it("无选中仓库时跳过持久化", async () => {
    const reorderProfilesFn = vi.fn();
    const { result } = renderHook(() =>
      useProfileOrdering({
        selectedRepoId: null,
        onOptimisticUpdate: vi.fn(),
        onReorderFailed: vi.fn(),
        reorderProfilesFn,
        profileT: en.profiles,
      })
    );

    act(() => {
      result.current.reorderVisibleProfiles([
        { id: "p-1", profileGroup: "g" } as unknown as ConfigProfile,
      ]);
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reorderProfilesFn).not.toHaveBeenCalled();
  });

  it("前一次排序失败后队列自动恢复", async () => {
    const reorderProfilesFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("first boom"))
      .mockResolvedValueOnce(undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onReorderFailed = vi.fn().mockResolvedValue(undefined);

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
        { id: "p-1", profileGroup: null } as unknown as ConfigProfile,
      ]);
    });
    await waitFor(() => expect(onReorderFailed).toHaveBeenCalledOnce());

    act(() => {
      result.current.reorderVisibleProfiles([
        { id: "p-1", profileGroup: "g" } as unknown as ConfigProfile,
      ]);
    });
    await waitFor(() => expect(reorderProfilesFn).toHaveBeenCalledTimes(2));
  });
});
