import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface UseRepositoryListInteractionStateOptions {
  filteredRepoIds: string[];
  selectedRepoId: string | null;
}

export interface RepositoryListInteractionState {
  hoveredRepoId: string | null;
  focusedRepoId: string | null;
  activeMenuRepoId: string | null;
  visualTargetRepoId: string | null;
  freezeFloating: boolean;
  handleRowMouseEnter: (repoId: string) => void;
  handleRowFocus: (repoId: string) => void;
  handleRowBlur: (repoId: string) => void;
  handlePointerRepoChange: (repoId: string | null) => void;
  handleListPointerEnter: () => void;
  handleListPointerLeave: () => void;
  handleMenuOpenChange: (repoId: string, open: boolean) => void;
  isMenuOpenForRepo: (repoId: string) => boolean;
}

export function useRepositoryListInteractionState({
  filteredRepoIds,
  selectedRepoId,
}: UseRepositoryListInteractionStateOptions): RepositoryListInteractionState {
  const [hoveredRepoId, setHoveredRepoId] = useState<string | null>(null);
  const [focusedRepoId, setFocusedRepoId] = useState<string | null>(null);
  const [activeMenuRepoId, setActiveMenuRepoId] = useState<string | null>(null);
  const [pointerInsideList, setPointerInsideList] = useState(false);
  const activeMenuRepoIdRef = useRef<string | null>(null);
  const pointerInsideListRef = useRef(false);

  const filteredRepoIdsSignature = useMemo(
    () => filteredRepoIds.join("|"),
    [filteredRepoIds]
  );

  useEffect(() => {
    const filteredRepoIdSet = new Set(filteredRepoIds);

    setHoveredRepoId((prev) => (prev && !filteredRepoIdSet.has(prev) ? null : prev));
    setFocusedRepoId((prev) => (prev && !filteredRepoIdSet.has(prev) ? null : prev));
    setActiveMenuRepoId((prev) => {
      const nextValue = prev && !filteredRepoIdSet.has(prev) ? null : prev;
      activeMenuRepoIdRef.current = nextValue;
      return nextValue;
    });
  }, [filteredRepoIdsSignature, filteredRepoIds]);

  const visualTargetRepoId = useMemo(
    () =>
      activeMenuRepoId ??
      (pointerInsideList ? hoveredRepoId : null) ??
      focusedRepoId ??
      selectedRepoId ??
      null,
    [activeMenuRepoId, focusedRepoId, hoveredRepoId, pointerInsideList, selectedRepoId]
  );

  useEffect(() => {
    activeMenuRepoIdRef.current = activeMenuRepoId;
  }, [activeMenuRepoId]);

  useEffect(() => {
    pointerInsideListRef.current = pointerInsideList;
  }, [pointerInsideList]);

  const handleRowMouseEnter = useCallback((repoId: string) => {
    setHoveredRepoId((prev) => (prev === repoId ? prev : repoId));
  }, []);

  const handleRowFocus = useCallback((repoId: string) => {
    setFocusedRepoId((prev) => (prev === repoId ? prev : repoId));
  }, []);

  const handleRowBlur = useCallback((repoId: string) => {
    setFocusedRepoId((prev) => (prev === repoId ? null : prev));
  }, []);

  const handlePointerRepoChange = useCallback(
    (repoId: string | null) => {
      if (activeMenuRepoIdRef.current) {
        return;
      }

      setHoveredRepoId((prev) => (prev === repoId ? prev : repoId));
    },
    []
  );

  const handleListPointerEnter = useCallback(() => {
    pointerInsideListRef.current = true;
    setPointerInsideList(true);
  }, []);

  const handleListPointerLeave = useCallback(() => {
    pointerInsideListRef.current = false;
    setPointerInsideList(false);

    if (activeMenuRepoIdRef.current) {
      return;
    }

    setHoveredRepoId(null);
  }, []);

  const handleMenuOpenChange = useCallback(
    (repoId: string, open: boolean) => {
      if (open) {
        activeMenuRepoIdRef.current = repoId;
        setActiveMenuRepoId(repoId);
        setHoveredRepoId(repoId);
        return;
      }

      activeMenuRepoIdRef.current = null;
      setActiveMenuRepoId((prev) => (prev === repoId ? null : prev));

      if (!pointerInsideListRef.current) {
        setHoveredRepoId(null);
      }
    },
    []
  );

  const isMenuOpenForRepo = useCallback(
    (repoId: string) => activeMenuRepoId === repoId,
    [activeMenuRepoId]
  );

  return {
    hoveredRepoId,
    focusedRepoId,
    activeMenuRepoId,
    visualTargetRepoId,
    freezeFloating: activeMenuRepoId !== null,
    handleRowMouseEnter,
    handleRowFocus,
    handleRowBlur,
    handlePointerRepoChange,
    handleListPointerEnter,
    handleListPointerLeave,
    handleMenuOpenChange,
    isMenuOpenForRepo,
  };
}
