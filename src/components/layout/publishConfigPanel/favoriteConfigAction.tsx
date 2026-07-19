import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { type RowActionsMenuAction } from "@/components/layout/RowActionsMenu";

export function createFavoriteConfigAction({
  isFavorite,
  favoriteLabel,
  unfavoriteLabel,
  onSelect,
}: {
  isFavorite: boolean;
  favoriteLabel: string;
  unfavoriteLabel: string;
  onSelect: () => void | Promise<unknown>;
}): RowActionsMenuAction {
  return {
    key: "favorite",
    label: isFavorite ? unfavoriteLabel : favoriteLabel,
    icon: (
      <Star
        className={cn(
          "size-3.5",
          isFavorite ? "fill-success text-success" : "text-muted-foreground"
        )}
      />
    ),
    onSelect,
  };
}
