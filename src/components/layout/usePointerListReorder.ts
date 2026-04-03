import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  type ListDropTarget,
  projectDraggedItemPosition,
  resolveDropTargetByDraggedCenter,
} from "@/lib/listOrdering";

export type PointerListDropTarget<TMeta> = ListDropTarget<TMeta>;

type PointerListDragDirection = "up" | "down" | null;

interface PointerListPointer {
  x: number;
  y: number;
}

interface PointerListSize {
  width: number;
  height: number;
}

interface PointerListItemEntry<TMeta> {
  meta: TMeta;
  node: HTMLElement | null;
}

export function usePointerListReorder<TMeta>(params: {
  enabled: boolean;
  onCommit: (activeItemId: string, target: PointerListDropTarget<TMeta>) => void;
  onStart?: () => void;
}) {
  const { enabled, onCommit, onStart } = params;
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] =
    useState<PointerListDropTarget<TMeta> | null>(null);
  const [dragPreviewOffset, setDragPreviewOffset] = useState({
    x: 0,
    y: 0,
  });
  const [dragPointer, setDragPointer] = useState<PointerListPointer | null>(null);
  const [dragAnchor, setDragAnchor] = useState<PointerListPointer | null>(null);
  const [draggedItemSize, setDraggedItemSize] =
    useState<PointerListSize | null>(null);
  const [dragDirection, setDragDirection] =
    useState<PointerListDragDirection>(null);
  const draggingItemIdRef = useRef<string | null>(null);
  const dropTargetRef = useRef<PointerListDropTarget<TMeta> | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const itemEntriesRef = useRef<Record<string, PointerListItemEntry<TMeta>>>({});
  const dragPointerRef = useRef<PointerListPointer | null>(null);
  const dragAnchorRef = useRef<PointerListPointer | null>(null);
  const draggedItemSizeRef = useRef<PointerListSize | null>(null);
  const dragPreviewOffsetRef = useRef({ x: 0, y: 0 });
  const dragDirectionRef = useRef<PointerListDragDirection>(null);
  const lastPointerYRef = useRef<number | null>(null);
  const initialRowRectRef = useRef<DOMRect | null>(null);

  const clearGlobalDragEffects = useCallback(() => {
    dragCleanupRef.current?.();
    dragCleanupRef.current = null;
  }, []);

  const setLiveTarget = useCallback(
    (nextTarget: PointerListDropTarget<TMeta> | null) => {
      dropTargetRef.current = nextTarget;
      setDropTarget((previousTarget) => {
        if (!previousTarget && !nextTarget) {
          return previousTarget;
        }
        if (!previousTarget || !nextTarget) {
          return nextTarget;
        }
        if (
          previousTarget.itemId === nextTarget.itemId &&
          previousTarget.position === nextTarget.position
        ) {
          return previousTarget;
        }
        return nextTarget;
      });
    },
    []
  );

  const clearDragState = useCallback(() => {
    clearGlobalDragEffects();
    dragPointerRef.current = null;
    dragAnchorRef.current = null;
    draggedItemSizeRef.current = null;
    dragPreviewOffsetRef.current = { x: 0, y: 0 };
    dragDirectionRef.current = null;
    lastPointerYRef.current = null;
    initialRowRectRef.current = null;
    draggingItemIdRef.current = null;
    setDraggingItemId(null);
    setLiveTarget(null);
    setDragPreviewOffset({ x: 0, y: 0 });
    setDragPointer(null);
    setDragAnchor(null);
    setDraggedItemSize(null);
    setDragDirection(null);
  }, [clearGlobalDragEffects, setLiveTarget]);

  const syncDragPreviewOffset = useCallback(
    (pointer = dragPointerRef.current) => {
      const activeItemId = draggingItemIdRef.current;
      const activeAnchor = dragAnchorRef.current;
      const activeItemSize = draggedItemSizeRef.current;

      if (!activeItemId || !pointer || !activeAnchor || !activeItemSize) {
        return;
      }

      const referenceRect =
        (() => {
          const rowRect = itemEntriesRef.current[activeItemId]?.node?.getBoundingClientRect();
          if (!rowRect) {
            return initialRowRectRef.current;
          }

          return {
            left: rowRect.left - dragPreviewOffsetRef.current.x,
            top: rowRect.top - dragPreviewOffsetRef.current.y,
          };
        })() ?? initialRowRectRef.current;

      if (!referenceRect) {
        return;
      }

      const projection = projectDraggedItemPosition({
        pointerX: pointer.x,
        pointerY: pointer.y,
        anchorOffsetX: activeAnchor.x,
        anchorOffsetY: activeAnchor.y,
        itemWidth: activeItemSize.width,
        itemHeight: activeItemSize.height,
      });

      const nextOffset = {
        x: projection.left - referenceRect.left,
        y: projection.top - referenceRect.top,
      };

      if (
        Math.abs(dragPreviewOffsetRef.current.x - nextOffset.x) < 0.5 &&
        Math.abs(dragPreviewOffsetRef.current.y - nextOffset.y) < 0.5
      ) {
        return;
      }

      dragPreviewOffsetRef.current = nextOffset;

      setDragPreviewOffset((previousOffset) => {
        if (
          Math.abs(previousOffset.x - nextOffset.x) < 0.5 &&
          Math.abs(previousOffset.y - nextOffset.y) < 0.5
        ) {
          return previousOffset;
        }
        return nextOffset;
      });
    },
    []
  );

  const updateLiveTargetFromPointer = useCallback(
    (pointer = dragPointerRef.current) => {
      const activeItemId = draggingItemIdRef.current;
      const activeAnchor = dragAnchorRef.current;
      const activeItemSize = draggedItemSizeRef.current;

      if (!activeItemId || !pointer || !activeAnchor || !activeItemSize) {
        setLiveTarget(null);
        return;
      }

      const projection = projectDraggedItemPosition({
        pointerX: pointer.x,
        pointerY: pointer.y,
        anchorOffsetX: activeAnchor.x,
        anchorOffsetY: activeAnchor.y,
        itemWidth: activeItemSize.width,
        itemHeight: activeItemSize.height,
      });

      const geometries = Object.entries(itemEntriesRef.current)
        .map(([itemId, entry]) => {
          const rect = entry.node?.getBoundingClientRect();
          if (!rect || rect.height <= 0 || rect.width <= 0) {
            return null;
          }

          return {
            itemId,
            top: rect.top,
            height: rect.height,
            meta: entry.meta,
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);

      const nextTarget = resolveDropTargetByDraggedCenter({
        activeItemId,
        activeCenterY: projection.centerY,
        items: geometries,
      });

      setLiveTarget(nextTarget);
    },
    [setLiveTarget]
  );

  const setItemRef = useCallback(
    (itemId: string, meta: TMeta) => (node: HTMLElement | null) => {
      if (node) {
        itemEntriesRef.current[itemId] = { meta, node };
        return;
      }

      delete itemEntriesRef.current[itemId];
    },
    []
  );

  const startDrag = useCallback(
    (itemId: string, event: ReactPointerEvent<HTMLElement>) => {
      if (!enabled) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const rowElement =
        itemEntriesRef.current[itemId]?.node ??
        event.currentTarget.closest<HTMLElement>("[data-list-row='true']");
      if (!rowElement) {
        return;
      }

      const rowRect = rowElement.getBoundingClientRect();
      const nextPointer = {
        x: event.clientX,
        y: event.clientY,
      };
      const nextAnchor = {
        x: event.clientX - rowRect.left,
        y: event.clientY - rowRect.top,
      };
      const nextItemSize = {
        width: rowRect.width,
        height: rowRect.height,
      };

      clearGlobalDragEffects();
      initialRowRectRef.current = rowRect;
      dragPointerRef.current = nextPointer;
      dragAnchorRef.current = nextAnchor;
      draggedItemSizeRef.current = nextItemSize;
      dragDirectionRef.current = null;
      lastPointerYRef.current = event.clientY;
      draggingItemIdRef.current = itemId;
      setDraggingItemId(itemId);
      setLiveTarget(null);
      dragPreviewOffsetRef.current = { x: 0, y: 0 };
      setDragPreviewOffset({ x: 0, y: 0 });
      setDragPointer(nextPointer);
      setDragAnchor(nextAnchor);
      setDraggedItemSize(nextItemSize);
      setDragDirection(null);

      const previousUserSelect = document.body.style.userSelect;
      const previousCursor = document.body.style.cursor;
      document.body.style.userSelect = "none";
      document.body.style.cursor = "grabbing";

      const updateDragPreview = (pointerEvent: PointerEvent) => {
        if (!draggingItemIdRef.current) {
          return;
        }

        const nextDirection =
          lastPointerYRef.current === null || pointerEvent.clientY === lastPointerYRef.current
            ? dragDirectionRef.current
            : pointerEvent.clientY > lastPointerYRef.current
              ? "down"
              : "up";

        lastPointerYRef.current = pointerEvent.clientY;
        dragDirectionRef.current = nextDirection;
        setDragDirection((previousDirection) =>
          previousDirection === nextDirection
            ? previousDirection
            : nextDirection
        );

        const nextPointer = {
          x: pointerEvent.clientX,
          y: pointerEvent.clientY,
        };

        dragPointerRef.current = nextPointer;
        setDragPointer((previousPointer) => {
          if (
            previousPointer?.x === nextPointer.x &&
            previousPointer?.y === nextPointer.y
          ) {
            return previousPointer;
          }
          return nextPointer;
        });
        syncDragPreviewOffset(nextPointer);
        updateLiveTargetFromPointer(nextPointer);
      };

      const finishDrag = () => {
        const activeItemId = draggingItemIdRef.current;
        const target = dropTargetRef.current;

        clearDragState();

        if (!activeItemId || !target || activeItemId === target.itemId) {
          return;
        }

        onCommit(activeItemId, target);
      };

      window.addEventListener("pointermove", updateDragPreview);
      window.addEventListener("pointerup", finishDrag);
      window.addEventListener("pointercancel", finishDrag);
      window.addEventListener("blur", finishDrag);
      dragCleanupRef.current = () => {
        window.removeEventListener("pointermove", updateDragPreview);
        window.removeEventListener("pointerup", finishDrag);
        window.removeEventListener("pointercancel", finishDrag);
        window.removeEventListener("blur", finishDrag);
        document.body.style.userSelect = previousUserSelect;
        document.body.style.cursor = previousCursor;
      };

      onStart?.();
    },
    [
      clearDragState,
      clearGlobalDragEffects,
      enabled,
      onCommit,
      onStart,
      setLiveTarget,
      syncDragPreviewOffset,
      updateLiveTargetFromPointer,
    ]
  );

  useEffect(() => {
    return () => {
      clearGlobalDragEffects();
    };
  }, [clearGlobalDragEffects]);

  useLayoutEffect(() => {
    if (!draggingItemId) {
      return;
    }

    syncDragPreviewOffset();
  }, [dragPointer?.x, dragPointer?.y, draggingItemId, dropTarget, syncDragPreviewOffset]);

  const dragPreviewStyle = useMemo<CSSProperties | undefined>(() => {
    if (!draggingItemId) {
      return undefined;
    }

    return {
      transform: `translate3d(${dragPreviewOffset.x}px, ${dragPreviewOffset.y}px, 0)`,
      willChange: "transform",
    };
  }, [dragPreviewOffset.x, dragPreviewOffset.y, draggingItemId]);

  return {
    draggingItemId,
    dropTarget,
    liveTarget: dropTarget,
    dragPreviewStyle,
    dragPointer,
    dragAnchor,
    draggedItemSize,
    dragDirection,
    setItemRef,
    startDrag,
    clearDragState,
  };
}
