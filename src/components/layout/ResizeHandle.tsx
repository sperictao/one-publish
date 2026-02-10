import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface ResizeHandleProps {
  onResize: (delta: number) => void;
  onResizeEnd?: () => void;
  direction?: "horizontal" | "vertical";
  className?: string;
  /** Height of the header section that needs border-b */
  headerHeight?: string;
}

export function ResizeHandle({
  onResize,
  onResizeEnd,
  direction = "horizontal",
  className,
  headerHeight = "h-10",
}: ResizeHandleProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [startPos, setStartPos] = useState(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      setStartPos(direction === "horizontal" ? e.clientX : e.clientY);
    },
    [direction]
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const currentPos = direction === "horizontal" ? e.clientX : e.clientY;
      const delta = currentPos - startPos;
      if (delta !== 0) {
        onResize(delta);
        setStartPos(currentPos);
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      onResizeEnd?.();
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    // Change cursor globally while dragging
    document.body.style.cursor = direction === "horizontal" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isDragging, startPos, direction, onResize, onResizeEnd]);

  return (
    <div
      className={cn(
        "group relative flex-shrink-0 glass-transition flex flex-col",
        direction === "horizontal"
          ? "w-1 cursor-col-resize hover:bg-[var(--glass-bg-hover)]"
          : "h-1 cursor-row-resize hover:bg-[var(--glass-bg-hover)]",
        isDragging && "bg-[var(--glass-bg-active)]",
        className
      )}
      onMouseDown={handleMouseDown}
    >
      {/* Header section with border to connect horizontal lines */}
      {direction === "horizontal" && headerHeight && (
        <div data-tauri-drag-region className={cn(headerHeight, "flex-shrink-0 border-b border-[var(--glass-divider)]")} />
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
    </div>
  );
}
