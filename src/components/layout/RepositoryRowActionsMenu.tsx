import type { Repository } from "@/types/repository";
import { Pencil, Trash2 } from "lucide-react";
import { RowActionsMenu } from "./RowActionsMenu";

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
    <RowActionsMenu
      open={open}
      moreActionsLabel={moreActionsLabel}
      itemLabel={repo.name}
      actions={[
        {
          key: "edit",
          label: repoT.edit || "编辑",
          icon: <Pencil className="h-3.5 w-3.5 text-muted-foreground/70" />,
          onSelect: () => onEdit(repo),
        },
        {
          key: "remove",
          label: repoT.remove || "移除",
          icon: <Trash2 className="h-3.5 w-3.5" />,
          onSelect: () => onRemove(repo),
          destructive: true,
          separatorBefore: true,
        },
      ]}
      onOpenChange={onOpenChange}
    />
  );
}
