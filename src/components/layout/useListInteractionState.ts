import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

interface UseListInteractionStateOptions {
  filteredItemIds: string[];
  selectedItemId: string | null;
  resetKey?: string | null;
}

export interface ListInteractionState {
  hoveredItemId: string | null;
  focusedItemId: string | null;
  activeMenuItemId: string | null;
  visualTargetItemId: string | null;
  freezeFloating: boolean;
  handleRowMouseEnter: (itemId: string) => void;
  handleRowFocus: (itemId: string) => void;
  handleRowBlur: (itemId: string) => void;
  handlePointerItemChange: (itemId: string | null) => void;
  handleListPointerEnter: () => void;
  handleListPointerLeave: () => void;
  handleMenuOpenChange: (itemId: string, open: boolean) => void;
  isMenuOpenForItem: (itemId: string) => boolean;
}

export function useListInteractionState({
  filteredItemIds,
  selectedItemId,
  resetKey = null,
}: UseListInteractionStateOptions): ListInteractionState {
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);
  const [activeMenuItemId, setActiveMenuItemId] = useState<string | null>(null);
  const [pointerInsideList, setPointerInsideList] = useState(false);
  const activeMenuItemIdRef = useRef<string | null>(null);
  const pointerInsideListRef = useRef(false);
  const previousResetKeyRef = useRef<string | null | undefined>(resetKey);

  const filteredItemIdsSignature = useMemo(
    () => filteredItemIds.join("|"),
    [filteredItemIds]
  );

  useLayoutEffect(() => {
    const filteredItemIdSet = new Set(filteredItemIds);

    setHoveredItemId((prev) =>
      prev && !filteredItemIdSet.has(prev) ? null : prev
    );
    setFocusedItemId((prev) =>
      prev && !filteredItemIdSet.has(prev) ? null : prev
    );
    setActiveMenuItemId((prev) => {
      const nextValue = prev && !filteredItemIdSet.has(prev) ? null : prev;
      activeMenuItemIdRef.current = nextValue;
      return nextValue;
    });
  }, [filteredItemIdsSignature, filteredItemIds]);

  const visualTargetItemId = useMemo(
    () =>
      activeMenuItemId ??
      (pointerInsideList ? hoveredItemId : null) ??
      focusedItemId ??
      selectedItemId ??
      null,
    [activeMenuItemId, focusedItemId, hoveredItemId, pointerInsideList, selectedItemId]
  );

  useEffect(() => {
    activeMenuItemIdRef.current = activeMenuItemId;
  }, [activeMenuItemId]);

  useEffect(() => {
    pointerInsideListRef.current = pointerInsideList;
  }, [pointerInsideList]);

  useLayoutEffect(() => {
    if (previousResetKeyRef.current === resetKey) {
      return;
    }

    previousResetKeyRef.current = resetKey;
    activeMenuItemIdRef.current = null;
    pointerInsideListRef.current = false;
    setHoveredItemId(null);
    setFocusedItemId(null);
    setActiveMenuItemId(null);
    setPointerInsideList(false);
  }, [resetKey]);

  const handleRowMouseEnter = useCallback((itemId: string) => {
    setHoveredItemId((prev) => (prev === itemId ? prev : itemId));
  }, []);

  const handleRowFocus = useCallback((itemId: string) => {
    setFocusedItemId((prev) => (prev === itemId ? prev : itemId));
  }, []);

  const handleRowBlur = useCallback((itemId: string) => {
    setFocusedItemId((prev) => (prev === itemId ? null : prev));
  }, []);

  const handlePointerItemChange = useCallback((itemId: string | null) => {
    if (activeMenuItemIdRef.current) {
      return;
    }

    setHoveredItemId((prev) => (prev === itemId ? prev : itemId));
  }, []);

  const handleListPointerEnter = useCallback(() => {
    pointerInsideListRef.current = true;
    setPointerInsideList(true);
  }, []);

  const handleListPointerLeave = useCallback(() => {
    pointerInsideListRef.current = false;
    setPointerInsideList(false);

    if (activeMenuItemIdRef.current) {
      return;
    }

    setHoveredItemId(null);
  }, []);

  const handleMenuOpenChange = useCallback((itemId: string, open: boolean) => {
    if (open) {
      activeMenuItemIdRef.current = itemId;
      setActiveMenuItemId(itemId);
      setHoveredItemId(itemId);
      return;
    }

    activeMenuItemIdRef.current = null;
    setActiveMenuItemId((prev) => (prev === itemId ? null : prev));

    if (!pointerInsideListRef.current) {
      setHoveredItemId(null);
    }
  }, []);

  const isMenuOpenForItem = useCallback(
    (itemId: string) => activeMenuItemId === itemId,
    [activeMenuItemId]
  );

  return {
    hoveredItemId,
    focusedItemId,
    activeMenuItemId,
    visualTargetItemId,
    freezeFloating: activeMenuItemId !== null,
    handleRowMouseEnter,
    handleRowFocus,
    handleRowBlur,
    handlePointerItemChange,
    handleListPointerEnter,
    handleListPointerLeave,
    handleMenuOpenChange,
    isMenuOpenForItem,
  };
}
