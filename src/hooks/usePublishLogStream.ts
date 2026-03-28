import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface PublishLogChunkEvent {
  sessionId: string;
  line: string;
}

export function usePublishLogStream() {
  const [outputLog, setOutputLogState] = useState("");
  const outputLogRef = useRef(outputLog);

  const setOutputLog = useCallback((nextLog: string) => {
    outputLogRef.current = nextLog;
    setOutputLogState(nextLog);
  }, []);

  const appendOutputLog = useCallback((chunk: string) => {
    if (!chunk) {
      return;
    }

    setOutputLogState((prev) => {
      const next = `${prev}${chunk}`;
      outputLogRef.current = next;
      return next;
    });
  }, []);

  const getOutputLogSnapshot = useCallback(() => outputLogRef.current, []);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    let unlisten: (() => void) | null = null;

    listen<PublishLogChunkEvent>("provider-publish-log", (event) => {
      const line = event.payload?.line;
      if (!line) return;

      appendOutputLog(line);
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
    setOutputLog,
    getOutputLogSnapshot,
  };
}
