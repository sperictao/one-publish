import type { PointerEvent as ReactPointerEvent } from "react";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DropPosition } from "@/lib/listOrdering";

interface ListDragHandleProps {
  enabled: boolean;
  label: string;
  disabledLabel?: string;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}

export function ListDragHandle({
  enabled,
  label,
  disabledLabel,
  onPointerDown,
}: ListDragHandleProps): JSX.Element {
  return (
    <div className="absolute inset-y-0 left-2 z-20 flex items-center">
      <button
        type="button"
        aria-label={enabled ? label : disabledLabel || label}
        title={enabled ? label : disabledLabel || label}
        className={cn(
          "flex h-7 w-7 touch-none items-center justify-center rounded-xl transition-all duration-200",
          enabled
            ? "cursor-grab text-muted-foreground/35 opacity-0 group-hover:opacity-100 hover:bg-[var(--glass-bg)] hover:text-foreground/65 active:cursor-grabbing"
            : "cursor-not-allowed text-muted-foreground/20 opacity-0 group-hover:opacity-100"
        )}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onPointerDown={(event) => {
          if (!enabled) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }

          onPointerDown(event);
        }}
      >
        <GripVertical className="h-4 w-4" />
      </button>
    </div>
  );
}

interface ListDropIndicatorProps {
  position: DropPosition | null;
}

export function ListDropIndicator({
  position,
}: ListDropIndicatorProps): JSX.Element | null {
  if (!position) {
    return null;
  }

  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute left-3 right-3 z-30 h-0.5 rounded-full bg-primary/65 shadow-[0_0_0_1px_hsl(var(--background)),0_0_10px_hsl(var(--primary)/0.18)]",
        position === "before" ? "top-0" : "bottom-0"
      )}
    />
  );
}
