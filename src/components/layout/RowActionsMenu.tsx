import { Fragment, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type RowActionsMenuAction = {
  key: string;
  label: string;
  icon: ReactNode;
  onSelect: () => unknown;
  destructive?: boolean;
  separatorBefore?: boolean;
};

interface RowActionsMenuProps {
  open: boolean;
  moreActionsLabel: string;
  itemLabel: string;
  actions: RowActionsMenuAction[];
  onOpenChange: (open: boolean) => void;
  stopPropagation?: boolean;
}

export function RowActionsMenu({
  open,
  moreActionsLabel,
  itemLabel,
  actions,
  onOpenChange,
  stopPropagation = false,
}: RowActionsMenuProps): ReactNode {
  const handleTriggerEvent = stopPropagation
    ? (event: { stopPropagation: () => void }) => {
        event.stopPropagation();
      }
    : undefined;

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6 rounded-md transition-opacity duration-150 ease-geist opacity-0 group-hover:opacity-75 group-focus-within:opacity-75 data-[state=open]:bg-accent/80 data-[state=open]:opacity-100"
          title={moreActionsLabel}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`${moreActionsLabel}: ${itemLabel}`}
          onPointerDown={handleTriggerEvent}
          onClick={handleTriggerEvent}
          onKeyDown={handleTriggerEvent}
        >
          <MoreHorizontal className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6}>
        {actions.map((action) => (
          <Fragment key={action.key}>
            {action.separatorBefore ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem
              className={cn(
                action.destructive && "text-destructive focus:bg-destructive/10"
              )}
              onSelect={() => {
                void action.onSelect();
              }}
            >
              {action.icon}
              <span>{action.label}</span>
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
