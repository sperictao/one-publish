import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

interface PublishLogChunkEvent {
  sessionId: string;
  line: string;
}

export function usePublishLogStream() {
  const [outputLog, setOutputLog] = useState("");

  useEffect(() => {
    if (!(window as any).__TAURI__) {
      return;
    }

    let unlisten: (() => void) | null = null;

    listen<PublishLogChunkEvent>("provider-publish-log", (event) => {
      const line = event.payload?.line?.trimEnd();
      if (!line) return;

      setOutputLog((prev) => (prev ? `${prev}\n${line}` : line));
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
