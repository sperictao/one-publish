import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import type { Repository } from "@/types/repository";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";

interface RepositoryRowActionsMenuProps {
  repo: Repository;
  open: boolean;
  repoT: Record<string, string | undefined>;
  onOpenChange: (open: boolean) => void;
  onEdit: (repo: Repository) => Promise<unknown> | unknown;
  onRemove: (repo: Repository) => Promise<unknown> | unknown;
}

export function RepositoryRowActionsMenu({
  repo,
  open,
  repoT,
  onOpenChange,
  onEdit,
  onRemove,
}: RepositoryRowActionsMenuProps): JSX.Element {
  const moreActionsLabel = repoT.moreActions || "更多操作";

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 rounded-lg transition-all duration-300 opacity-0 group-hover:opacity-75 group-focus-within:opacity-75 data-[state=open]:bg-[var(--glass-bg-active)] data-[state=open]:opacity-100"
          title={moreActionsLabel}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`${moreActionsLabel}: ${repo.name}`}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6}>
        <DropdownMenuItem onSelect={() => onEdit(repo)}>
          <Pencil className="h-3.5 w-3.5 text-muted-foreground/70" />
          <span>{repoT.edit || "编辑"}</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:bg-destructive/10"
          onSelect={() => void onRemove(repo)}
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span>{repoT.remove || "移除"}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
