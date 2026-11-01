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

// 捕获层上限：capturedOutputLogRef 会进入执行记录，失控构建输出不能让
// renderer 内存无界增长。超出后保留末尾并对齐换行，截断标记在快照读出时钉入。
export const MAX_CAPTURED_LOG_CHARS = 5_000_000;
const CAPTURE_TRUNCATION_SLACK = 64_000;
const TRUNCATED_CAPTURE_MARKER = "[one-publish: earlier output truncated]\n";

// 换行对齐只在截断点后的有限前瞻内查找——超长单行不能让对齐丢弃整段保留内容。
const TRUNCATION_ALIGN_LOOKAHEAD = 4096;

// 超限时保留尾部：优先在截断点后的前瞻窗口内对齐到换行；窗口内没有换行
// 就保留完整尾部，不能让对齐逻辑反过来丢掉内容。
function retainTail(log: string, maxChars: number): string {
  const tail = log.slice(log.length - maxChars);
  const newlineIndex = tail.slice(0, TRUNCATION_ALIGN_LOOKAHEAD).indexOf("\n");
  return newlineIndex >= 0 ? tail.slice(newlineIndex + 1) : tail;
}

function clampVisibleLog(log: string): string {
  if (log.length <= MAX_VISIBLE_LOG_CHARS) {
    return log;
  }
  return retainTail(log, MAX_VISIBLE_LOG_CHARS);
}

// 捕获缓冲的 tail 截断：返回 null 表示未超限；否则返回保留下来的尾部文本。
export function retainCapturedLogTail(log: string): string | null {
  if (log.length <= MAX_CAPTURED_LOG_CHARS + CAPTURE_TRUNCATION_SLACK) {
    return null;
  }
  return retainTail(log, MAX_CAPTURED_LOG_CHARS);
}

export function usePublishLogStream() {
  const [outputLog, setOutputLogState] = useState("");
  const capturedOutputLogRef = useRef("");
  const capturedTruncatedRef = useRef(false);
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
    () =>
      capturedTruncatedRef.current
        ? `${TRUNCATED_CAPTURE_MARKER}${capturedOutputLogRef.current}`
        : capturedOutputLogRef.current,
    []
  );

  const beginLogCapture = useCallback(() => {
    isCaptureEnabledRef.current = true;
    isVisibleCaptureEnabledRef.current = true;
    activeSessionIdRef.current = null;
    capturedOutputLogRef.current = "";
    capturedTruncatedRef.current = false;
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
    capturedTruncatedRef.current = false;
    replaceVisibleOutputLog("");
  }, [replaceVisibleOutputLog]);

  const replaceCapturedOutputLog = useCallback(
    (nextLog: string) => {
      const retained = retainCapturedLogTail(nextLog);
      capturedOutputLogRef.current = retained ?? nextLog;
      capturedTruncatedRef.current = retained !== null;
      if (isVisibleCaptureEnabledRef.current) {
        replaceVisibleOutputLog(capturedOutputLogRef.current);
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

      const next = `${capturedOutputLogRef.current}${line}`;
      const retained = retainCapturedLogTail(next);
      if (retained !== null) {
        capturedTruncatedRef.current = true;
        capturedOutputLogRef.current = retained;
      } else {
        capturedOutputLogRef.current = next;
      }

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
