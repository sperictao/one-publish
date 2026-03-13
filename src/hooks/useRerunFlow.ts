import { useCallback, useState } from "react";
import { toast } from "sonner";

import type { ExecutionRecord } from "@/lib/store";

interface TranslationMap {
  [key: string]: string | undefined;
}

interface RerunChecklistState {
  branch: boolean;
  environment: boolean;
  output: boolean;
}

interface ProviderPublishSpec {
  version: number;
  provider_id: string;
  project_path: string;
  parameters: Record<string, unknown>;
}

interface UseRerunFlowParams {
  isRerunChecklistEnabled: boolean;
  historyT: TranslationMap;
  rerunT: TranslationMap;
  extractSpecFromRecord: (record: ExecutionRecord) => ProviderPublishSpec | null;
  restoreSpecToEditor: (spec: ProviderPublishSpec) => void;
  getRecentConfigKeyFromSpec: (spec: ProviderPublishSpec) => string | null;
  runPublishWithSpec: (spec: ProviderPublishSpec, recentConfigKey?: string | null) => Promise<void>;
}

const INITIAL_CHECKLIST_STATE: RerunChecklistState = {
  branch: false,
  environment: false,
  output: false,
};

export function useRerunFlow({
  isRerunChecklistEnabled,
  historyT,
  rerunT,
  extractSpecFromRecord,
  restoreSpecToEditor,
  getRecentConfigKeyFromSpec,
  runPublishWithSpec,
}: UseRerunFlowParams) {
  const [rerunChecklistOpen, setRerunChecklistOpen] = useState(false);
  const [pendingRerunRecord, setPendingRerunRecord] = useState<ExecutionRecord | null>(null);
  const [rerunChecklistState, setRerunChecklistState] =
    useState<RerunChecklistState>(INITIAL_CHECKLIST_STATE);

  const executeRerunFromRecord = useCallback(
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
      await runPublishWithSpec(spec, getRecentConfigKeyFromSpec(spec));
    },
    [
      extractSpecFromRecord,
      getRecentConfigKeyFromSpec,
      historyT.historyMissingRecoverableSpec,
      historyT.historyMissingRecoverableSpecHint,
      restoreSpecToEditor,
      runPublishWithSpec,
    ]
  );

  const rerunFromHistory = useCallback(
    async (record: ExecutionRecord) => {
      if (!isRerunChecklistEnabled) {
        await executeRerunFromRecord(record);
        return;
      }

      setPendingRerunRecord(record);
      setRerunChecklistState(INITIAL_CHECKLIST_STATE);
      setRerunChecklistOpen(true);
    },
    [executeRerunFromRecord, isRerunChecklistEnabled]
  );

  const closeRerunChecklistDialog = useCallback(() => {
    setRerunChecklistOpen(false);
    setPendingRerunRecord(null);
    setRerunChecklistState(INITIAL_CHECKLIST_STATE);
  }, []);

  const confirmRerunWithChecklist = useCallback(async () => {
    if (!pendingRerunRecord) {
      return;
    }

    if (
      !rerunChecklistState.branch ||
      !rerunChecklistState.environment ||
      !rerunChecklistState.output
    ) {
      toast.error(rerunT.requireChecklist || "请先完成重跑前确认清单");
      return;
    }

    const record = pendingRerunRecord;
    closeRerunChecklistDialog();
    await executeRerunFromRecord(record);
  }, [
    closeRerunChecklistDialog,
    executeRerunFromRecord,
    pendingRerunRecord,
    rerunChecklistState,
    rerunT.requireChecklist,
  ]);

  return {
    rerunChecklistOpen,
    setRerunChecklistOpen,
    pendingRerunRecord,
    rerunChecklistState,
    setRerunChecklistState,
    rerunFromHistory,
    closeRerunChecklistDialog,
    confirmRerunWithChecklist,
  };
}
