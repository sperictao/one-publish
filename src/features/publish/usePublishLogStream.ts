import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  PublishLogChunkEvent,
  PublishSessionStartedEvent,
} from "@/generated/tauri-contracts";

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

    let disposed = false;
    let unlistenStarted: (() => void) | null = null;
    let unlistenChunk: (() => void) | null = null;

    // 后端在 spawn 前 emit 本事件，显式指定本次发布的会话 ID。
    // 收到时先重置捕获（清空缓冲 + null ref），再锁存为活动会话，
    // 替代旧的"首 chunk 锁存"，避免上一运行迟到 chunk 抢占新会话。
    listen<PublishSessionStartedEvent>(
      "provider-publish-session-started",
      (event) => {
        const sessionId = event.payload?.sessionId?.trim();
        if (!sessionId) {
          return;
        }
        beginLogCapture();
        activeSessionIdRef.current = sessionId;
      }
    )
      .then((dispose) => {
        if (disposed) {
          dispose();
          return;
        }
        unlistenStarted = dispose;
      })
      .catch((err) => {
        console.error("监听发布会话开始事件失败:", err);
      });

    // chunk 监听：未显式指定会话时一律丢弃（不再首 chunk 锁存）。
    listen<PublishLogChunkEvent>("provider-publish-log", (event) => {
      const sessionId = event.payload?.sessionId?.trim();
      const line = event.payload?.line;
      if (!isCaptureEnabledRef.current || !sessionId || !line) {
        return;
      }

      const activeSessionId = activeSessionIdRef.current;
      if (activeSessionId !== sessionId) {
        return;
      }

      capturedOutputLogRef.current = `${capturedOutputLogRef.current}${line}`;

      if (isVisibleCaptureEnabledRef.current) {
        appendOutputLog(line);
      }
    })
      .then((dispose) => {
        if (disposed) {
          dispose();
          return;
        }
        unlistenChunk = dispose;
      })
      .catch((err) => {
        console.error("监听发布日志失败:", err);
      });

    return () => {
      disposed = true;
      unlistenStarted?.();
      unlistenChunk?.();
    };
  }, [appendOutputLog, beginLogCapture]);

  return {
    outputLog,
    getOutputLogSnapshot,
    beginLogCapture,
    hideLogCapture,
    resetLogCapture,
    replaceCapturedOutputLog,
  };
}
