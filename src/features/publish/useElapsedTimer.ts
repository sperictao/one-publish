import { useEffect, useRef, useState } from "react";

/**
 * 运行耗时计时。active 为真时每秒累加 elapsedMs，转为假时停止。
 * 起点用 performance.now()（单调时钟，不受系统时间调整影响），
 * 非渲染值，避免 Date.now 带来的抖动。
 */
export function useElapsedTimer(active: boolean): number {
  const [elapsedMs, setElapsedMs] = useState(0);
  const startRef = useRef<number | null>(null);
  const [wasActive, setWasActive] = useState(active);

  // active 翻转为真时在渲染期同步归零，避免 effect 内同步 setState 的级联渲染。
  if (wasActive !== active) {
    setWasActive(active);
    if (active) {
      setElapsedMs(0);
    }
  }

  useEffect(() => {
    if (!active) {
      startRef.current = null;
      return;
    }

    startRef.current = performance.now();

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
  // 非有限值会让 Math.max / 取模传播出 NaN 或 Infinity，渲染成 "NaN:NaN" 之类的
  // 无效耗时；计时起点异常时统一按 0 处理，有限值（含负数、小数）行为不变。
  const totalSeconds = Number.isFinite(ms)
    ? Math.max(0, Math.floor(ms / 1000))
    : 0;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
