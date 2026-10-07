import { getCurrentTranslations } from "@/hooks/useI18n";
import { localizeInvokeError } from "@/lib/tauri/invokeErrors";
import { getAppState } from "@/lib/store/api";
import type { AppState } from "@/lib/store/types";
import { mergeBootstrapAppState } from "@/stores/appStoreMutations";
import { toast } from "sonner";

/**
 * Factory that creates a persistence-failure handler bound to a Zustand set function.
 * Used by slices to reload authoritative state and show a toast on persistence errors.
 */
export function makeHandlePersistenceFailure(
  set: (partial: Record<string, unknown>) => void,
  getState: () => AppState
) {
  return async (title: string, err: unknown) => {
    console.error(title, err);
    let description = localizeInvokeError(err, getCurrentTranslations());
    try {
      const authoritativeState = await getAppState();
      set({
        ...mergeBootstrapAppState(getState(), authoritativeState),
        error: null,
      });
    } catch (reloadError) {
      console.error("重新加载应用状态失败:", reloadError);
      description = `${description}；${localizeInvokeError(
        reloadError,
        getCurrentTranslations()
      )}`;
    }
    toast.error(title, { description });
  };
}
