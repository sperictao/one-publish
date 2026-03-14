import { useCallback, useEffect, useState } from "react";

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

  const MIN_PANEL_WIDTH = 150;
  const MAX_PANEL_WIDTH = 400;

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
    : Math.max(
        MIN_PANEL_WIDTH,
        Math.min(MAX_PANEL_WIDTH, Math.round(windowWidth * 0.2))
      );

  const effectiveMiddlePanelWidth = params.panelWidthsCustomized
    ? params.middlePanelWidth
    : Math.max(
        MIN_PANEL_WIDTH,
        Math.min(MAX_PANEL_WIDTH, Math.round(windowWidth * 0.2))
      );

  const handleLeftPanelResize = useCallback(
    (delta: number) => {
      const newWidth = Math.max(
        MIN_PANEL_WIDTH,
        Math.min(MAX_PANEL_WIDTH, effectiveLeftPanelWidth + delta)
      );
      params.setLeftPanelWidth(newWidth);
    },
    [effectiveLeftPanelWidth, params]
  );

  const handleMiddlePanelResize = useCallback(
    (delta: number) => {
      const newWidth = Math.max(
        MIN_PANEL_WIDTH,
        Math.min(MAX_PANEL_WIDTH, effectiveMiddlePanelWidth + delta)
      );
      params.setMiddlePanelWidth(newWidth);
    },
    [effectiveMiddlePanelWidth, params]
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
