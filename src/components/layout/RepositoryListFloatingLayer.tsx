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
  handleRepoMouseEnter: (repoId: string) => void;
  handleListPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleListPointerEnter: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleListMouseLeave: () => void;
  handleListScroll: () => void;
}

interface RepositoryListFloatingLayerProps {
  filteredRepoIds: string[];
  selectedRepoId: string | null;
  children: (bindings: RepositoryListFloatingBindings) => ReactNode;
}

export function RepositoryListFloatingLayer({
  filteredRepoIds,
  selectedRepoId,
  children,
}: RepositoryListFloatingLayerProps) {
  const floatingBindings = useFloatingRepoCard({
    filteredRepoIds,
    selectedRepoId,
  });

  return <>{children(floatingBindings)}</>;
}
