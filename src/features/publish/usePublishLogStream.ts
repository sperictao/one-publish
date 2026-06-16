import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { PublishLogChunkEvent } from "@/generated/tauri-contracts";

// 可见日志层的最大保留字符数。完整日志仍存于 capturedOutputLogRef，
// 此上限仅约束渲染到 DOM 的文本量，避免超长发布日志拖垮渲染性能。
const MAX_VISIBLE_LOG_CHARS = 200_000;

// 超限时保留尾部，并对齐到下一个换行，避免在行中间截断。
function clampVisibleLog(log: string): string {
  if (log.length <= MAX_VISIBLE_LOG_CHARS) {
    return log;
  }
  const tail = log.slice(log.length - MAX_VISIBLE_LOG_CHARS);
  const newlineIndex = tail.indexOf("\n");
  return newlineIndex >= 0 ? tail.slice(newlineIndex + 1) : tail;
}

export function usePublishLogStream() {
  const [outputLog, setOutputLogState] = useState("");
  const capturedOutputLogRef = useRef("");
  const activeSessionIdRef = useRef<string | null>(null);
  const isCaptureEnabledRef = useRef(false);
  const isVisibleCaptureEnabledRef = useRef(false);

  const replaceVisibleOutputLog = useCallback((nextLog: string) => {
    setOutputLogState(clampVisibleLog(nextLog));
  }, []);

  const appendOutputLog = useCallback((chunk: string) => {
    if (!chunk) {
      return;
    }

    setOutputLogState((prev) => clampVisibleLog(`${prev}${chunk}`));
  }, []);

  const getOutputLogSnapshot = useCallback(
    () => capturedOutputLogRef.current,
    []
  );

  const beginLogCapture = useCallback(() => {
    isCaptureEnabledRef.current = true;
    isVisibleCaptureEnabledRef.current = true;
    activeSessionIdRef.current = null;
    capturedOutputLogRef.current = "";
    replaceVisibleOutputLog("");
  }, [replaceVisibleOutputLog]);

  const hideLogCapture = useCallback(() => {
    isVisibleCaptureEnabledRef.current = false;
    replaceVisibleOutputLog("");
  }, [replaceVisibleOutputLog]);

  const resetLogCapture = useCallback(() => {
    isCaptureEnabledRef.current = false;
    isVisibleCaptureEnabledRef.current = false;
    activeSessionIdRef.current = null;
    capturedOutputLogRef.current = "";
    replaceVisibleOutputLog("");
  }, [replaceVisibleOutputLog]);

  const replaceCapturedOutputLog = useCallback(
    (nextLog: string) => {
      capturedOutputLogRef.current = nextLog;
      if (isVisibleCaptureEnabledRef.current) {
        replaceVisibleOutputLog(nextLog);
      }
    },
    [replaceVisibleOutputLog]
  );

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    let unlisten: (() => void) | null = null;

    listen<PublishLogChunkEvent>("provider-publish-log", (event) => {
      const sessionId = event.payload?.sessionId?.trim();
      const line = event.payload?.line;
      if (!isCaptureEnabledRef.current || !sessionId || !line) {
        return;
      }

      const activeSessionId = activeSessionIdRef.current;
      if (activeSessionId && activeSessionId !== sessionId) {
        return;
      }

      if (!activeSessionId) {
        activeSessionIdRef.current = sessionId;
      }

      capturedOutputLogRef.current = `${capturedOutputLogRef.current}${line}`;

      if (isVisibleCaptureEnabledRef.current) {
        appendOutputLog(line);
      }
    })
      .then((dispose) => {
        unlisten = dispose;
      })
      .catch((err) => {
        console.error("监听发布日志失败:", err);
      });

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [appendOutputLog]);

  return {
    outputLog,
    getOutputLogSnapshot,
    beginLogCapture,
    hideLogCapture,
    resetLogCapture,
    replaceCapturedOutputLog,
  };
}
