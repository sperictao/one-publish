import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface PublishLogChunkEvent {
  sessionId: string;
  line: string;
}

export function usePublishLogStream() {
  const [outputLog, setOutputLog] = useState("");

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    let unlisten: (() => void) | null = null;

    listen<PublishLogChunkEvent>("provider-publish-log", (event) => {
      const line = event.payload?.line;
      if (!line) return;

      setOutputLog((prev) => `${prev}${line}`);
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
  }, []);

  return {
    outputLog,
    setOutputLog,
  };
}
