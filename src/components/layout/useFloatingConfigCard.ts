import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useFloatingListCard } from "./useFloatingListCard";

interface UseFloatingConfigCardOptions {
  filteredConfigIds: string[];
  targetConfigId: string | null;
  restingTargetConfigId: string | null;
  selectedConfigId: string | null;
  freezeFloating: boolean;
  onListPointerEnter: () => void;
  onListPointerLeave: () => void;
  onPointerConfigChange: (configId: string | null) => void;
}

interface UseFloatingConfigCardResult {
  listRef: React.MutableRefObject<HTMLDivElement | null>;
  floatingCardSurfaceRef: React.MutableRefObject<HTMLDivElement | null>;
  cardTargetConfigId: string | null;
  floatingVisible: boolean;
  floatingCardMotionStyle: CSSProperties;
  floatingCardSurfaceStyle: CSSProperties;
  setConfigRowRef: (configId: string) => (node: HTMLDivElement | null) => void;
  handleListPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleListPointerEnter: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleListMouseLeave: () => void;
  handleListScroll: () => void;
}

export function useFloatingConfigCard({
  filteredConfigIds,
  targetConfigId,
  restingTargetConfigId,
  selectedConfigId,
  freezeFloating,
  onListPointerEnter,
  onListPointerLeave,
  onPointerConfigChange,
}: UseFloatingConfigCardOptions): UseFloatingConfigCardResult {
  const floatingBindings = useFloatingListCard({
    filteredItemIds: filteredConfigIds,
    targetItemId: targetConfigId,
    restingTargetItemId: restingTargetConfigId,
    selectedItemId: selectedConfigId,
    freezeFloating,
    onListPointerEnter,
    onListPointerLeave,
    onPointerItemChange: onPointerConfigChange,
    preserveHoverOnGap: true,
  });

  return {
    listRef: floatingBindings.listRef,
    floatingCardSurfaceRef: floatingBindings.floatingCardSurfaceRef,
    cardTargetConfigId: floatingBindings.cardTargetItemId,
    floatingVisible: floatingBindings.floatingVisible,
    floatingCardMotionStyle: floatingBindings.floatingCardMotionStyle,
    floatingCardSurfaceStyle: floatingBindings.floatingCardSurfaceStyle,
    setConfigRowRef: floatingBindings.setItemRowRef,
    handleListPointerMove: floatingBindings.handleListPointerMove,
    handleListPointerEnter: floatingBindings.handleListPointerEnter,
    handleListMouseLeave: floatingBindings.handleListPointerLeave,
    handleListScroll: floatingBindings.handleListScroll,
  };
}
