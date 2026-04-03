import {
  type PointerEvent as ReactPointerEvent,
  type CSSProperties,
} from "react";
import { useFloatingListCard } from "./useFloatingListCard";

interface UseFloatingRepoCardOptions {
  filteredRepoIds: string[];
  targetRepoId: string | null;
  restingTargetRepoId: string | null;
  selectedRepoId: string | null;
  snapTargetRepoId: string | null;
  draggingRepoId: string | null;
  freezeFloating: boolean;
  onListPointerEnter: () => void;
  onListPointerLeave: () => void;
  onPointerRepoChange: (repoId: string | null) => void;
}

interface UseFloatingRepoCardResult {
  listRef: React.MutableRefObject<HTMLDivElement | null>;
  floatingCardSurfaceRef: React.MutableRefObject<HTMLDivElement | null>;
  cardTargetRepoId: string | null;
  floatingVisible: boolean;
  floatingCardMotionStyle: CSSProperties;
  floatingCardSurfaceStyle: CSSProperties;
  setRepoRowRef: (repoId: string) => (node: HTMLDivElement | null) => void;
  handleListPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleListPointerEnter: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleListMouseLeave: () => void;
  handleListScroll: () => void;
}

export function useFloatingRepoCard({
  filteredRepoIds,
  targetRepoId,
  restingTargetRepoId,
  selectedRepoId,
  snapTargetRepoId,
  draggingRepoId,
  freezeFloating,
  onListPointerEnter,
  onListPointerLeave,
  onPointerRepoChange,
}: UseFloatingRepoCardOptions): UseFloatingRepoCardResult {
  const floatingBindings = useFloatingListCard({
    filteredItemIds: filteredRepoIds,
    targetItemId: targetRepoId,
    restingTargetItemId: restingTargetRepoId,
    selectedItemId: selectedRepoId,
    snapTargetItemId: snapTargetRepoId,
    draggingItemId: draggingRepoId,
    freezeFloating,
    onListPointerEnter,
    onListPointerLeave,
    onPointerItemChange: onPointerRepoChange,
  });

  return {
    listRef: floatingBindings.listRef,
    floatingCardSurfaceRef: floatingBindings.floatingCardSurfaceRef,
    cardTargetRepoId: floatingBindings.cardTargetItemId,
    floatingVisible: floatingBindings.floatingVisible,
    floatingCardMotionStyle: floatingBindings.floatingCardMotionStyle,
    floatingCardSurfaceStyle: floatingBindings.floatingCardSurfaceStyle,
    setRepoRowRef: floatingBindings.setItemRowRef,
    handleListPointerMove: floatingBindings.handleListPointerMove,
    handleListPointerEnter: floatingBindings.handleListPointerEnter,
    handleListMouseLeave: floatingBindings.handleListPointerLeave,
    handleListScroll: floatingBindings.handleListScroll,
  };
}
