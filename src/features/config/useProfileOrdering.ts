import { useCallback } from "react";

import { useLazyRef } from "@/hooks/useLazyRef";
import { toast } from "sonner";

import type { ConfigProfile, ProfileOrderEntry } from "@/lib/store/types";
import type { TranslationMap } from "./types";

const loadInvokeErrors = () => import("@/lib/tauri/invokeErrors");

export interface UseProfileOrderingParams {
  selectedRepoId: string | null;
  /** Called immediately with the reordered profiles for optimistic UI update. */
  onOptimisticUpdate: (nextProfiles: ConfigProfile[]) => void;
  /** Called when the backend reorder fails, to reload the authoritative list. */
  onReorderFailed: () => Promise<void>;
  reorderProfilesFn: (params: {
    repoId: string;
    profiles: ProfileOrderEntry[];
  }) => Promise<unknown>;
  profileT: TranslationMap;
}

export interface UseProfileOrderingReturn {
  reorderVisibleProfiles: (nextProfiles: ConfigProfile[]) => void;
}

export function useProfileOrdering({
  selectedRepoId,
  onOptimisticUpdate,
  onReorderFailed,
  reorderProfilesFn,
  profileT,
}: UseProfileOrderingParams): UseProfileOrderingReturn {
  const reorderProfilesQueueRef = useLazyRef<Promise<void>>(() => Promise.resolve());
  const selectedRepoIdRef = useLazyRef<string | null>(() => selectedRepoId);
  selectedRepoIdRef.current = selectedRepoId;

  const reorderVisibleProfiles = useCallback(
    (nextProfiles: ConfigProfile[]) => {
      const repoId = selectedRepoId;
      if (!repoId) {
        return;
      }

      const nextProfileOrder: ProfileOrderEntry[] = nextProfiles.map(
        (profile) => ({
          name: profile.name,
          profileGroup: profile.profileGroup ?? null,
        })
      );

      onOptimisticUpdate(nextProfiles);

      reorderProfilesQueueRef.current = reorderProfilesQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          try {
            await reorderProfilesFn({
              repoId,
              profiles: nextProfileOrder,
            });
          } catch (err) {
            console.error("保存配置排序失败:", err);

            if (selectedRepoIdRef.current === repoId) {
              await onReorderFailed();
            }

            const { extractInvokeErrorMessage } = await loadInvokeErrors();
            toast.error(profileT.quickEditFailed || "更新配置文件失败", {
              description: extractInvokeErrorMessage(err),
            });
          }
        });
    },
    [
      onOptimisticUpdate,
      onReorderFailed,
      profileT.quickEditFailed,
      reorderProfilesFn,
      selectedRepoId,
    ]
  );

  return {
    reorderVisibleProfiles,
  };
}
