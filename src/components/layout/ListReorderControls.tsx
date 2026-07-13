import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
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
}: ListDragHandleProps): ReactNode {
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
          "flex size-7 touch-none items-center justify-center rounded-sm transition-colors duration-150 ease-geist",
          enabled
            ? "cursor-grab text-gray-600 hover:bg-gray-alpha-100 hover:text-foreground active:cursor-grabbing"
            : "cursor-not-allowed text-gray-500"
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
