import { useFloatingConfigCard } from "./useFloatingConfigCard";
import type {
  CSSProperties,
  MutableRefObject,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";

export interface PublishConfigFloatingBindings {
  listRef: MutableRefObject<HTMLDivElement | null>;
  floatingCardSurfaceRef: MutableRefObject<HTMLDivElement | null>;
  cardTargetConfigId: string | null;
  floatingVisible: boolean;
  floatingCardMotionStyle: CSSProperties;
  floatingCardSurfaceStyle: CSSProperties;
  setConfigRowRef: (configId: string) => (node: HTMLDivElement | null) => void;
  handleConfigMouseEnter: (configId: string) => void;
  handleListPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleListPointerEnter: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleListMouseLeave: () => void;
  handleListScroll: () => void;
}

interface PublishConfigPanelFloatingLayerProps {
  allConfigIds: string[];
  selectedRenderId: string | null;
  children: (bindings: PublishConfigFloatingBindings) => ReactNode;
}

export function PublishConfigPanelFloatingLayer({
  allConfigIds,
  selectedRenderId,
  children,
}: PublishConfigPanelFloatingLayerProps) {
  const {
    listRef,
    floatingCardSurfaceRef,
    cardTargetRepoId,
    floatingVisible,
    floatingCardMotionStyle,
    floatingCardSurfaceStyle,
    setRepoRowRef,
    handleRepoMouseEnter,
    handleListPointerMove,
    handleListPointerEnter,
    handleListMouseLeave,
    handleListScroll,
  } = useFloatingConfigCard({
    filteredRepoIds: allConfigIds,
    selectedRepoId: selectedRenderId,
    enablePointerFollow: true,
    preserveHoverOnGap: true,
  });

  return (
    <>
      {children({
        listRef,
        floatingCardSurfaceRef,
        cardTargetConfigId: cardTargetRepoId,
        floatingVisible,
        floatingCardMotionStyle,
        floatingCardSurfaceStyle,
        setConfigRowRef: setRepoRowRef,
        handleConfigMouseEnter: handleRepoMouseEnter,
        handleListPointerMove,
        handleListPointerEnter,
        handleListMouseLeave,
        handleListScroll,
      })}
    </>
  );
}
