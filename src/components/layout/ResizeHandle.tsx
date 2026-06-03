import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/hooks/useI18n";

interface ResizeHandleProps {
  onResize: (delta: number) => void;
  onResizeEnd?: () => void;
  direction?: "horizontal" | "vertical";
  className?: string;
  /** Height of the header section that needs border-b */
  headerHeight?: string;
  /** Whether to show border-b on the header spacer (default: true) */
  showHeaderBorder?: boolean;
}

export function ResizeHandle({
  onResize,
  onResizeEnd,
  direction = "horizontal",
  className,
  headerHeight = "h-10",
  showHeaderBorder = true,
}: ResizeHandleProps) {
  const [isDragging, setIsDragging] = useState(false);
  const startPosRef = useRef(0);
  const cleanupDragRef = useRef<(() => void) | null>(null);
  const { translations } = useI18n();
  const commonT = translations.common || {};

  const cleanupDrag = useCallback(() => {
    cleanupDragRef.current?.();
    cleanupDragRef.current = null;
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      cleanupDrag();
      setIsDragging(true);
      startPosRef.current = direction === "horizontal" ? e.clientX : e.clientY;

      const handleMouseMove = (event: MouseEvent) => {
        const currentPos =
          direction === "horizontal" ? event.clientX : event.clientY;
        const delta = currentPos - startPosRef.current;
        if (delta !== 0) {
          onResize(delta);
          startPosRef.current = currentPos;
        }
      };

      const handleMouseUp = () => {
        cleanupDrag();
        setIsDragging(false);
        onResizeEnd?.();
      };

      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor =
        direction === "horizontal" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";

      cleanupDragRef.current = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
      };
    },
    [cleanupDrag, direction, onResize, onResizeEnd]
  );

  useEffect(() => {
    return cleanupDrag;
  }, [cleanupDrag]);

  return (
    <button
      type="button"
      aria-label={
        direction === "horizontal"
          ? commonT.resizePanelWidth || "调整面板宽度"
          : commonT.resizePanelHeight || "调整面板高度"
      }
      className={cn(
        "group relative flex flex-col flex-shrink-0 appearance-none border-0 bg-transparent p-0 glass-transition",
        direction === "horizontal"
          ? "w-1 cursor-col-resize hover:bg-[var(--glass-bg-hover)]"
          : "h-1 cursor-row-resize hover:bg-[var(--glass-bg-hover)]",
        isDragging && "bg-[var(--glass-bg-active)]",
        className
      )}
      onMouseDown={handleMouseDown}
    >
      {/* Header spacer to align with adjacent panel headers */}
      {direction === "horizontal" && headerHeight && (
        <div
          data-tauri-drag-region
          className={cn(
            headerHeight,
            "flex-shrink-0",
            showHeaderBorder && "border-b border-[var(--glass-divider)]"
          )}
        />
      )}
      {/* Remaining space */}
      <div className="flex-1" />
      {/* Visual indicator on hover */}
      <div
        className={cn(
          "absolute opacity-0 group-hover:opacity-100 transition-opacity bg-primary/40",
          direction === "horizontal"
            ? "top-0 bottom-0 left-0 w-0.5"
            : "left-0 right-0 top-0 h-0.5",
          isDragging && "opacity-100"
        )}
      />
    </button>
  );
}
