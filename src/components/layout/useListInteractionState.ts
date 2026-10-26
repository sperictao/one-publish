import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface UseListInteractionStateOptions {
  filteredItemIds: string[];
  selectedItemId: string | null;
  resetKey?: string | null;
}

export interface ListInteractionState {
  visualTargetItemId: string | null;
  handleRowMouseEnter: (itemId: string) => void;
  handleRowFocus: (itemId: string) => void;
  handleRowBlur: (itemId: string) => void;
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

  const filteredItemIdsSignature = useMemo(
    () => filteredItemIds.join("|"),
    [filteredItemIds]
  );

  const [prevFilterSignature, setPrevFilterSignature] = useState(
    filteredItemIdsSignature
  );
  if (prevFilterSignature !== filteredItemIdsSignature) {
    setPrevFilterSignature(filteredItemIdsSignature);
    const filteredItemIdSet = new Set(filteredItemIds);
    if (hoveredItemId && !filteredItemIdSet.has(hoveredItemId)) {
      setHoveredItemId(null);
    }
    if (focusedItemId && !filteredItemIdSet.has(focusedItemId)) {
      setFocusedItemId(null);
    }
    if (activeMenuItemId && !filteredItemIdSet.has(activeMenuItemId)) {
      setActiveMenuItemId(null);
    }
  }

  const visualTargetItemId = useMemo(
    () =>
      activeMenuItemId ??
      (pointerInsideList ? hoveredItemId : null) ??
      focusedItemId ??
      selectedItemId ??
      null,
    [
      activeMenuItemId,
      focusedItemId,
      hoveredItemId,
      pointerInsideList,
      selectedItemId,
    ]
  );

  useEffect(() => {
    activeMenuItemIdRef.current = activeMenuItemId;
  }, [activeMenuItemId]);

  useEffect(() => {
    pointerInsideListRef.current = pointerInsideList;
  }, [pointerInsideList]);

  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey);
    setHoveredItemId(null);
    setFocusedItemId(null);
    setActiveMenuItemId(null);
    setPointerInsideList(false);
  }

  const handleRowMouseEnter = useCallback((itemId: string) => {
    setHoveredItemId((prev) => (prev === itemId ? prev : itemId));
  }, []);

  const handleRowFocus = useCallback((itemId: string) => {
    setFocusedItemId((prev) => (prev === itemId ? prev : itemId));
  }, []);

  const handleRowBlur = useCallback((itemId: string) => {
    setFocusedItemId((prev) => (prev === itemId ? null : prev));
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
    visualTargetItemId,
    handleRowMouseEnter,
    handleRowFocus,
    handleRowBlur,
    handleListPointerEnter,
    handleListPointerLeave,
    handleMenuOpenChange,
    isMenuOpenForItem,
  };
}
