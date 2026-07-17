import { useCallback } from "react";
import { toast } from "sonner";

import type { ExecutionRecord } from "@/lib/store/types";
import type { ProviderPublishSpec } from "@/features/publish/publishRuntime";
import type { RunPublishOptions } from "@/features/publish/publishTransaction";

interface TranslationMap {
  [key: string]: string | undefined;
}

interface UseRerunFlowParams {
  historyT: TranslationMap;
  extractSpecFromRecord: (record: ExecutionRecord) => ProviderPublishSpec | null;
  restoreSpecToEditor: (spec: ProviderPublishSpec) => void;
  getRecentConfigKeyFromSpec: (spec: ProviderPublishSpec) => string | null;
  runPublishSpec: (spec: ProviderPublishSpec, options?: RunPublishOptions) => Promise<void>;
}

export function useRerunFlow({
  historyT,
  extractSpecFromRecord,
  restoreSpecToEditor,
  getRecentConfigKeyFromSpec,
  runPublishSpec,
}: UseRerunFlowParams) {
  const rerunFromHistory = useCallback(
    async (record: ExecutionRecord) => {
      const spec = extractSpecFromRecord(record);
      if (!spec) {
        toast.error(historyT.historyMissingRecoverableSpec || "历史记录缺少可恢复的发布参数", {
          description:
            historyT.historyMissingRecoverableSpecHint ||
            "请使用最新版本重新执行一次后再重跑",
        });
        return;
      }

      restoreSpecToEditor(spec);
      await runPublishSpec(spec, {
        recentConfigKey: getRecentConfigKeyFromSpec(spec),
      });
    },
    [
      extractSpecFromRecord,
      getRecentConfigKeyFromSpec,
      historyT.historyMissingRecoverableSpec,
      historyT.historyMissingRecoverableSpecHint,
      restoreSpecToEditor,
      runPublishSpec,
    ]
  );

  return { rerunFromHistory };
}
