import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

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

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      startPosRef.current = direction === "horizontal" ? e.clientX : e.clientY;
    },
    [direction]
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const currentPos = direction === "horizontal" ? e.clientX : e.clientY;
      const delta = currentPos - startPosRef.current;
      if (delta !== 0) {
        onResize(delta);
        startPosRef.current = currentPos;
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      onResizeEnd?.();
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    // Change cursor globally while dragging
    document.body.style.cursor =
      direction === "horizontal" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isDragging, direction, onResize, onResizeEnd]);

  return (
    <button
      type="button"
      aria-label={direction === "horizontal" ? "调整面板宽度" : "调整面板高度"}
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
