import type { ReactNode } from "react";
import type { Repository } from "@/lib/store/types";
import { FolderOpen, Pencil, Trash2 } from "lucide-react";
import { RowActionsMenu } from "./RowActionsMenu";

interface RepositoryRowActionsMenuProps {
  repo: Repository;
  open: boolean;
  repoT: Record<string, string | undefined>;
  onOpenChange: (open: boolean) => void;
  onOpenDirectory: (repo: Repository) => Promise<unknown> | unknown;
  onEdit: (repo: Repository) => Promise<unknown> | unknown;
  onRemove: (repo: Repository) => Promise<unknown> | unknown;
}

export function RepositoryRowActionsMenu({
  repo,
  open,
  repoT,
  onOpenChange,
  onOpenDirectory,
  onEdit,
  onRemove,
}: RepositoryRowActionsMenuProps): ReactNode {
  const moreActionsLabel = repoT.moreActions || "更多操作";

  return (
    <RowActionsMenu
      open={open}
      moreActionsLabel={moreActionsLabel}
      itemLabel={repo.name}
      actions={[
        {
          key: "open-directory",
          label: repoT.openRepositoryDirectory || "打开目录",
          icon: <FolderOpen className="size-3.5 text-muted-foreground/70" />,
          onSelect: () => onOpenDirectory(repo),
        },
        {
          key: "edit",
          label: repoT.editRepositoryAction || "编辑仓库",
          icon: <Pencil className="size-3.5 text-muted-foreground/70" />,
          onSelect: () => onEdit(repo),
        },
        {
          key: "remove",
          label: repoT.removeRepositoryAction || "移除仓库",
          icon: <Trash2 className="size-3.5" />,
          onSelect: () => onRemove(repo),
          destructive: true,
          separatorBefore: true,
        },
      ]}
      onOpenChange={onOpenChange}
    />
  );
}
