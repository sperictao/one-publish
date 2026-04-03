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
  handleListPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleListPointerEnter: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleListMouseLeave: () => void;
  handleListScroll: () => void;
}

interface PublishConfigPanelFloatingLayerProps {
  filteredConfigIds: string[];
  targetConfigId: string | null;
  restingTargetConfigId: string | null;
  selectedConfigId: string | null;
  draggingConfigId: string | null;
  freezeFloating: boolean;
  onListPointerEnter: () => void;
  onListPointerLeave: () => void;
  onPointerConfigChange: (configId: string | null) => void;
  children: (bindings: PublishConfigFloatingBindings) => ReactNode;
}

export function PublishConfigPanelFloatingLayer({
  filteredConfigIds,
  targetConfigId,
  restingTargetConfigId,
  selectedConfigId,
  draggingConfigId,
  freezeFloating,
  onListPointerEnter,
  onListPointerLeave,
  onPointerConfigChange,
  children,
}: PublishConfigPanelFloatingLayerProps) {
  const {
    listRef,
    floatingCardSurfaceRef,
    cardTargetConfigId,
    floatingVisible,
    floatingCardMotionStyle,
    floatingCardSurfaceStyle,
    setConfigRowRef,
    handleListPointerMove,
    handleListPointerEnter,
    handleListMouseLeave,
    handleListScroll,
  } = useFloatingConfigCard({
    filteredConfigIds,
    targetConfigId,
    restingTargetConfigId,
    selectedConfigId,
    draggingConfigId,
    freezeFloating,
    onListPointerEnter,
    onListPointerLeave,
    onPointerConfigChange,
  });

  return (
    <>
      {children({
        listRef,
        floatingCardSurfaceRef,
        cardTargetConfigId,
        floatingVisible,
        floatingCardMotionStyle,
        floatingCardSurfaceStyle,
        setConfigRowRef,
        handleListPointerMove,
        handleListPointerEnter,
        handleListMouseLeave,
        handleListScroll,
      })}
    </>
  );
}
