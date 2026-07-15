import { useCallback, useEffect, useRef, useState } from "react";

const MIN_PANEL_WIDTH = 150;
const MAX_PANEL_WIDTH = 400;

const clampPanelWidth = (width: number) =>
  Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, width));

export function useLayoutShellState(params: {
  panelWidthsCustomized: boolean;
  leftPanelWidth: number;
  middlePanelWidth: number;
  setLeftPanelWidth: (width: number) => void;
  setMiddlePanelWidth: (width: number) => void;
}) {
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [middlePanelCollapsed, setMiddlePanelCollapsed] = useState(false);
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);

  useEffect(() => {
    if (params.panelWidthsCustomized) {
      return;
    }

    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [params.panelWidthsCustomized]);

  const effectiveLeftPanelWidth = params.panelWidthsCustomized
    ? params.leftPanelWidth
    : clampPanelWidth(Math.round(windowWidth * 0.2));

  const effectiveMiddlePanelWidth = params.panelWidthsCustomized
    ? params.middlePanelWidth
    : clampPanelWidth(Math.round(windowWidth * 0.2));

  // 拖拽实时宽度：ResizeHandle 的 document 级 mousemove 监听在整个拖拽序列中
  // 持有同一个回调闭包，且 setState 为异步批处理——若以渲染期快照为基准累加，
  // 增量会互相覆盖。ref 在回调内同步自增，使累加与渲染时序解耦。
  const widthRef = useRef({
    left: effectiveLeftPanelWidth,
    middle: effectiveMiddlePanelWidth,
  });
  widthRef.current.left = effectiveLeftPanelWidth;
  widthRef.current.middle = effectiveMiddlePanelWidth;

  const { setLeftPanelWidth, setMiddlePanelWidth } = params;

  const handleLeftPanelResize = useCallback(
    (delta: number) => {
      const newWidth = clampPanelWidth(widthRef.current.left + delta);
      widthRef.current.left = newWidth;
      setLeftPanelWidth(newWidth);
    },
    [setLeftPanelWidth]
  );

  const handleMiddlePanelResize = useCallback(
    (delta: number) => {
      const newWidth = clampPanelWidth(widthRef.current.middle + delta);
      widthRef.current.middle = newWidth;
      setMiddlePanelWidth(newWidth);
    },
    [setMiddlePanelWidth]
  );

  return {
    leftPanelCollapsed,
    setLeftPanelCollapsed,
    middlePanelCollapsed,
    setMiddlePanelCollapsed,
    effectiveLeftPanelWidth,
    effectiveMiddlePanelWidth,
    handleLeftPanelResize,
    handleMiddlePanelResize,
  };
}
