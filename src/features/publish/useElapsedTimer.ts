import { useEffect, useRef, useState } from "react";

/**
 * 运行耗时计时。active 为真时每秒累加 elapsedMs，转为假时停止。
 * 起点用 performance.now()（单调时钟，不受系统时间调整影响），
 * 非渲染值，避免 Date.now 带来的抖动。
 */
export function useElapsedTimer(active: boolean): number {
  const [elapsedMs, setElapsedMs] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) {
      startRef.current = null;
      return;
    }

    startRef.current = performance.now();
    setElapsedMs(0);

    const tick = () => {
      if (startRef.current != null) {
        setElapsedMs(performance.now() - startRef.current);
      }
    };
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  return elapsedMs;
}

/** 毫秒格式化为 mm:ss。 */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
