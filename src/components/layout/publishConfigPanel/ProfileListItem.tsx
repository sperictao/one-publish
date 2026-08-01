import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  AlertTriangle,
  Eye,
  FileText,
  Layers3,
  Pencil,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { type ConfigProfile } from "@/lib/store/types";
import {
  RowActionsMenu,
  type RowActionsMenuAction,
} from "@/components/layout/RowActionsMenu";
import { ListDragHandle } from "@/components/layout/ListReorderControls";
import { createFavoriteConfigAction } from "@/components/layout/publishConfigPanel/favoriteConfigAction";
import { configRowClass } from "@/components/layout/publishConfigPanel/configRowClass";

export interface ProfileListItemProps {
  profile: ConfigProfile;
  configKey: string;
  configId: string;
  isSelected: boolean;
  isVisualTarget: boolean;
  isFavorite: boolean;
  isMenuOpen: boolean;
  onClick: () => void;
  onToggleFavorite: (configKey: string) => void;
  onView: () => void;
  onEdit: () => void;
  onEditComposition: () => void;
  canEdit: boolean;
  viewTitle: string;
  editTitle: string;
  compositionTitle: string;
  updateUnavailableTitle: string;
  deleteTitle: string;
  blockedDeleteTitle: string;
  blockedStatusTitle: string;
  favoriteLabel: string;
  unfavoriteLabel: string;
  moreActionsLabel: string;
  onDelete: () => void;
  onMenuOpenChange: (open: boolean) => void;
  rowRef: (node: HTMLDivElement | null) => void;
  onItemMouseEnter: () => void;
  onItemFocus: () => void;
  onItemBlur: () => void;
  groupKey: string;
  dragEnabled: boolean;
  dragHandleVisible: boolean;
  dragHandleLabel: string;
  dragDisabledLabel: string;
  isDragging: boolean;
  dragPreviewStyle?: CSSProperties;
  onHandlePointerDown: (
    profileId: string,
    event: ReactPointerEvent<HTMLButtonElement>
  ) => void;
}

// User profile item with delete button on hover
export function ProfileListItem({
  profile,
  configKey,
  configId,
  isSelected,
  isVisualTarget,
  isFavorite,
  isMenuOpen,
  onClick,
  onToggleFavorite,
  onView,
  onEdit,
  onEditComposition,
  canEdit,
  viewTitle,
  editTitle,
  compositionTitle,
  updateUnavailableTitle,
  deleteTitle,
  blockedDeleteTitle,
  blockedStatusTitle,
  favoriteLabel,
  unfavoriteLabel,
  moreActionsLabel,
  onDelete,
  onMenuOpenChange,
  rowRef,
  onItemMouseEnter,
  onItemFocus,
  onItemBlur,
  dragEnabled,
  dragHandleVisible,
  dragHandleLabel,
  dragDisabledLabel,
  isDragging,
  dragPreviewStyle,
  onHandlePointerDown,
}: ProfileListItemProps) {
  const actions: RowActionsMenuAction[] = [
    createFavoriteConfigAction({
      isFavorite,
      favoriteLabel,
      unfavoriteLabel,
      onSelect: () => onToggleFavorite(configKey),
    }),
  ];
  const deleteBlocked = profile.externalBindingIds.length > 0;
  const canUseUpdateEntry = !profile.isSystemDefault;

  actions.push({
    key: "view",
    label: viewTitle,
    icon: <Eye className="size-3.5 text-muted-foreground" />,
    onSelect: onView,
  });

  if (canUseUpdateEntry) {
    actions.push({
      key: "edit",
      label: canEdit ? editTitle : updateUnavailableTitle,
      icon: <Pencil className="size-3.5 text-muted-foreground" />,
      onSelect: onEdit,
      disabled: !canEdit,
    });
    actions.push({
      key: "composition",
      label: compositionTitle,
      icon: <Layers3 className="size-3.5 text-muted-foreground" />,
      onSelect: onEditComposition,
    });
  }

  if (!profile.isSystemDefault) {
    actions.push({
      key: "delete",
      label: deleteBlocked ? blockedDeleteTitle : deleteTitle,
      icon: <Trash2 className="size-3.5" />,
      onSelect: deleteBlocked ? onEdit : onDelete,
      disabled: deleteBlocked && !canEdit,
      destructive: !deleteBlocked,
      separatorBefore: canUseUpdateEntry,
    });
  }

  return (
    <div
      ref={rowRef}
      data-list-row="true"
      data-list-item-id={configId}
      data-list-visual-target={isVisualTarget ? "true" : "false"}
      data-list-menu-open={isMenuOpen ? "true" : "false"}
      className={cn(
        "group relative z-10",
        isDragging && "pointer-events-none z-40"
      )}
      style={isDragging ? dragPreviewStyle : undefined}
      onMouseEnter={onItemMouseEnter}
      onFocusCapture={onItemFocus}
      onBlurCapture={(event) => {
        const nextFocusTarget = event.relatedTarget;
        if (
          nextFocusTarget instanceof Node &&
          event.currentTarget.contains(nextFocusTarget)
        ) {
          return;
        }

        onItemBlur();
      }}
    >
      <ListDragHandle
        visible={dragHandleVisible}
        enabled={dragEnabled}
        label={dragHandleLabel}
        disabledLabel={dragDisabledLabel}
        onPointerDown={(event) => {
          onHandlePointerDown(profile.id, event);
        }}
      />
      <button
        type="button"
        aria-pressed={isSelected}
        className={cn(
          configRowClass,
          isSelected && "bg-accent",
          dragHandleVisible ? "pl-10" : "pl-3"
        )}
        onClick={onClick}
      >
        <span
          className={cn(
            "flex size-8 flex-shrink-0 items-center justify-center rounded-sm transition-colors duration-150 ease-geist",
            isSelected
              ? "bg-interactive/10"
              : "bg-muted group-hover:bg-interactive/10"
          )}
        >
          <FileText
            className={cn(
              "size-4 transition-colors duration-150 ease-geist",
              isSelected
                ? "text-interactive"
                : "text-muted-foreground group-hover:text-interactive"
            )}
          />
        </span>
        <div className="min-w-0 flex flex-1 items-center gap-2 overflow-hidden">
          <span
            className={cn(
              "truncate text-label-13 font-semibold transition-colors duration-150 ease-geist",
              isSelected ? "text-foreground" : "text-foreground/78"
            )}
          >
            {profile.name}
          </span>
          {profile.blockedReason ? (
            <span
              className="flex min-w-0 items-center gap-1 truncate text-label-11 text-warning"
              title={blockedStatusTitle}
              aria-label={blockedStatusTitle}
            >
              <AlertTriangle className="size-3 shrink-0" />
              <span className="truncate">{blockedStatusTitle}</span>
            </span>
          ) : null}
        </div>
      </button>
      <div className="absolute inset-y-0 right-3 flex items-center">
        <RowActionsMenu
          open={isMenuOpen}
          moreActionsLabel={moreActionsLabel}
          itemLabel={profile.name}
          actions={actions}
          onOpenChange={onMenuOpenChange}
          stopPropagation
        />
      </div>
    </div>
  );
}
