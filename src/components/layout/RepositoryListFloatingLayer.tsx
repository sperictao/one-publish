import { useFloatingRepoCard } from "./useFloatingRepoCard";
import type {
  CSSProperties,
  MutableRefObject,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";

export interface RepositoryListFloatingBindings {
  listRef: MutableRefObject<HTMLDivElement | null>;
  floatingCardSurfaceRef: MutableRefObject<HTMLDivElement | null>;
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

interface RepositoryListFloatingLayerProps {
  filteredRepoIds: string[];
  targetRepoId: string | null;
  restingTargetRepoId: string | null;
  selectedRepoId: string | null;
  draggingRepoId: string | null;
  freezeFloating: boolean;
  onListPointerEnter: () => void;
  onListPointerLeave: () => void;
  onPointerRepoChange: (repoId: string | null) => void;
  children: (bindings: RepositoryListFloatingBindings) => ReactNode;
}

export function RepositoryListFloatingLayer({
  filteredRepoIds,
  targetRepoId,
  restingTargetRepoId,
  selectedRepoId,
  draggingRepoId,
  freezeFloating,
  onListPointerEnter,
  onListPointerLeave,
  onPointerRepoChange,
  children,
}: RepositoryListFloatingLayerProps) {
  const floatingBindings = useFloatingRepoCard({
    filteredRepoIds,
    targetRepoId,
    restingTargetRepoId,
    selectedRepoId,
    draggingRepoId,
    freezeFloating,
    onListPointerEnter,
    onListPointerLeave,
    onPointerRepoChange,
  });

  return <>{children(floatingBindings)}</>;
}
