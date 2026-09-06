import { useCallback } from "react";

import type { ExecutionRecord } from "@/lib/store/types";
import type { PublishSource } from "@/features/publish/publishRuntime";
import type { RunPublishOptions } from "@/features/publish/publishTransaction";

interface UseRerunFlowParams {
  runPublishSpec: (
    source: PublishSource,
    options?: RunPublishOptions
  ) => Promise<void>;
}

export function useRerunFlow({ runPublishSpec }: UseRerunFlowParams) {
  const rerunFromHistory = useCallback(
    async (record: ExecutionRecord) => {
      // 历史重跑只携带 history 来源：后端从恢复快照还原原配置与已记录输入，
      // 不依赖草稿修订存活，也不依赖当前选中配置。无完整原配置的旧记录由
      // 后端返回 history_input_incomplete，按普通失败反馈呈现。
      await runPublishSpec({ kind: "history", recordId: record.id });
    },
    [runPublishSpec]
  );

  return { rerunFromHistory };
}
