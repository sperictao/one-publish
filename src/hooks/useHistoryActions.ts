import { useCallback } from "react";
import { toast } from "sonner";

import { buildGitHubActionsSnippet, buildShellHandoffSnippet, type HandoffSnippetFormat } from "@/lib/handoffSnippet";
import type { ProviderPublishSpec } from "@/lib/publishRuntime";
import { openExecutionSnapshot, setExecutionRecordSnapshot, type ExecutionRecord } from "@/lib/store";
import { extractInvokeErrorMessage } from "@/lib/tauri/invokeErrors";

interface TranslationMap {
  [key: string]: string | undefined;
}

interface UseHistoryActionsParams {
  appT: TranslationMap;
  historyT: TranslationMap;
  extractSpecFromRecord: (record: ExecutionRecord) => ProviderPublishSpec | null;
  setExecutionHistory: (history: ExecutionRecord[]) => void;
}

export function useHistoryActions({
  appT,
  historyT,
  extractSpecFromRecord,
  setExecutionHistory,
}: UseHistoryActionsParams) {
  const copyText = useCallback(async (text: string, label: string) => {
    const normalized = text.trim();
    if (!normalized) {
      toast.error((appT.missingCopyTarget || "缺少可复制的{{label}}")
        .replace("{{label}}", label));
      return;
    }

    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(normalized);
      } else {
        const input = document.createElement("textarea");
        input.value = normalized;
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.focus();
        input.select();

        const copied = document.execCommand("copy");
        document.body.removeChild(input);

        if (!copied) {
          throw new Error(appT.copyFailed || "复制失败");
        }
      }

      toast.success((appT.copySuccess || "{{label}}已复制").replace("{{label}}", label));
    } catch (err) {
      toast.error((appT.copyFailedWithLabel || "复制{{label}}失败").replace("{{label}}", label), {
        description: String(err),
      });
    }
  }, [appT]);

  const copyHandoffSnippet = useCallback(async (record: ExecutionRecord, format: HandoffSnippetFormat) => {
    if (!record.success) {
      toast.error(historyT.handoffOnlySuccess || "仅成功记录支持生成交接片段");
      return;
    }

    const spec = extractSpecFromRecord(record);
    if (!spec) {
      toast.error(historyT.missingRecoverableSpec || "该记录缺少可恢复的发布参数");
      return;
    }

    const snippet = format === "shell"
      ? buildShellHandoffSnippet({ spec, commandLine: record.commandLine })
      : buildGitHubActionsSnippet({ spec, commandLine: record.commandLine });

    await copyText(
      snippet,
      format === "shell"
        ? historyT.shellSnippetLabel || "Shell 交接片段"
        : historyT.ghaSnippetLabel || "GitHub Actions 交接片段"
    );
  }, [copyText, extractSpecFromRecord, historyT]);

  const openSnapshotFromRecord = useCallback(async (record: ExecutionRecord) => {
    try {
      const openedPath = await openExecutionSnapshot({
        snapshotPath: record.snapshotPath ?? null,
        outputDir: record.outputDir ?? null,
      });

      if (!record.snapshotPath || record.snapshotPath !== openedPath) {
        const history = await setExecutionRecordSnapshot(record.id, openedPath);
        setExecutionHistory(history);
      }

      toast.success(historyT.snapshotOpened || "已打开执行快照", { description: openedPath });
    } catch (err) {
      toast.error(historyT.openSnapshotFailed || "打开执行快照失败", {
        description: extractInvokeErrorMessage(err),
      });
    }
  }, [historyT.openSnapshotFailed, historyT.snapshotOpened, setExecutionHistory]);

  return {
    copyHandoffSnippet,
    openSnapshotFromRecord,
  };
}
