import type { PointerEvent as ReactPointerEvent } from "react";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

interface ListDragHandleProps {
  visible: boolean;
  enabled: boolean;
  label: string;
  disabledLabel?: string;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}

export function ListDragHandle({
  visible,
  enabled,
  label,
  disabledLabel,
  onPointerDown,
}: ListDragHandleProps): JSX.Element {
  if (!visible) {
    return <></>;
  }

  return (
    <div className="absolute inset-y-0 left-2 z-20 flex items-center">
      <button
        type="button"
        aria-label={enabled ? label : disabledLabel || label}
        title={enabled ? label : disabledLabel || label}
        className={cn(
          "flex size-7 touch-none items-center justify-center rounded-xl transition-all duration-200",
          enabled
            ? "cursor-grab text-muted-foreground/35 hover:bg-[var(--glass-bg)] hover:text-foreground/65 active:cursor-grabbing"
            : "cursor-not-allowed text-muted-foreground/20"
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
        <GripVertical className="size-4" />
      </button>
    </div>
  );
}
