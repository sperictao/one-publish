import { Clock, FileText, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { SectionLabel } from "@/components/ui/section-label";
import { RowActionsMenu } from "@/components/layout/RowActionsMenu";
import { ListDragHandle } from "@/components/layout/ListReorderControls";
import { createFavoriteConfigAction } from "@/components/layout/publishConfigPanel/favoriteConfigAction";
import { configRowClass } from "@/components/layout/publishConfigPanel/configRowClass";
import { composeNodeRefs } from "@/components/layout/composeNodeRefs";
import { createRecentConfigRenderId } from "@/features/config/publishConfigIdentity";
import type {
  PreferredSelectedRenderAnchor,
  PublishConfigRecentItem,
} from "@/components/layout/usePublishConfigListModel";
import type { usePointerListReorder } from "@/components/layout/usePointerListReorder";
import type { useListReorderMotion } from "@/components/layout/useListReorderMotion";
import type { useListInteractionState } from "@/components/layout/useListInteractionState";

export type RecentReorderController = ReturnType<
  typeof usePointerListReorder<undefined>
>;
export type RecentMotionController = ReturnType<typeof useListReorderMotion>;
export type ListInteractionController = ReturnType<
  typeof useListInteractionState
>;

/** 最近使用段：收藏/最近条目的行渲染（选择、收藏、移除、拖拽排序）。 */
export interface RecentConfigSectionProps {
  items: PublishConfigRecentItem[];
  recentlyUsedLabel: string;
  moreActionsLabel: string;
  favoriteLabel: string;
  unfavoriteLabel: string;
  removeRecentLabel: string;
  dragToReorderLabel: string;
  dragDisabledWhileSearchingLabel: string;
  dragEnabled: boolean;
  reorder: RecentReorderController;
  motion: RecentMotionController;
  interaction: ListInteractionController;
  visualTargetConfigId: string | null;
  selectedConfigId: string | null;
  selectedRenderId: string | null;
  favoriteSet: Set<string>;
  onToggleFavoriteConfig: (configKey: string) => void;
  onRemoveRecentConfig: (configKey: string) => void;
  onSelectItem: (item: PublishConfigRecentItem) => void;
  selectedRepoScopeId: string | null;
  onSelectRenderAnchor: (anchor: PreferredSelectedRenderAnchor) => void;
}

export function RecentConfigSection({
  items,
  recentlyUsedLabel,
  moreActionsLabel,
  favoriteLabel,
  unfavoriteLabel,
  removeRecentLabel,
  dragToReorderLabel,
  dragDisabledWhileSearchingLabel,
  dragEnabled,
  reorder,
  motion,
  interaction,
  visualTargetConfigId,
  selectedConfigId,
  selectedRenderId,
  favoriteSet,
  onToggleFavoriteConfig,
  onRemoveRecentConfig,
  onSelectItem,
  selectedRepoScopeId,
  onSelectRenderAnchor,
}: RecentConfigSectionProps) {
  return (
    <div className="space-y-1.5">
      <SectionLabel className="flex items-center gap-1.5 px-3 py-2">
        <Clock className="size-3.5" />
        <span>{recentlyUsedLabel}</span>
      </SectionLabel>
      {items.map((item) => {
        const renderId = createRecentConfigRenderId(item.key);
        return (
          <div
            key={`recent-${item.key}`}
            ref={composeNodeRefs(
              reorder.setItemRef(item.key, undefined),
              motion.setItemRef(item.key)
            )}
            data-list-row="true"
            data-list-item-id={renderId}
            data-list-visual-target={
              visualTargetConfigId === renderId ? "true" : "false"
            }
            data-list-menu-open={
              interaction.isMenuOpenForItem(renderId) ? "true" : "false"
            }
            className={cn(
              "group relative z-10",
              reorder.draggingItemId === item.key && "pointer-events-none z-40"
            )}
            style={
              reorder.draggingItemId === item.key
                ? reorder.dragPreviewStyle
                : undefined
            }
            onMouseEnter={() => interaction.handleRowMouseEnter(renderId)}
            onFocusCapture={() => interaction.handleRowFocus(renderId)}
            onBlurCapture={(event) => {
              const nextFocusTarget = event.relatedTarget;
              if (
                nextFocusTarget instanceof Node &&
                event.currentTarget.contains(nextFocusTarget)
              ) {
                return;
              }

              interaction.handleRowBlur(renderId);
            }}
          >
            <ListDragHandle
              visible={dragEnabled}
              enabled={dragEnabled}
              label={dragToReorderLabel}
              disabledLabel={dragDisabledWhileSearchingLabel}
              onPointerDown={(event) => {
                reorder.startDrag(item.key, event);
              }}
            />
            <button
              type="button"
              aria-pressed={item.key === selectedConfigId}
              className={cn(
                configRowClass,
                selectedRenderId === renderId && "bg-accent",
                dragEnabled ? "pl-10" : "pl-3"
              )}
              onClick={() => {
                onSelectRenderAnchor({
                  repoId: selectedRepoScopeId,
                  renderId,
                });
                onSelectItem(item);
              }}
            >
              <span
                className={cn(
                  "flex size-8 flex-shrink-0 items-center justify-center rounded-sm transition-colors duration-150 ease-geist",
                  selectedRenderId === renderId
                    ? "bg-interactive/10"
                    : "bg-muted group-hover:bg-interactive/10"
                )}
              >
                <FileText
                  className={cn(
                    "size-4 transition-colors duration-150 ease-geist",
                    selectedRenderId === renderId
                      ? "text-interactive"
                      : "text-muted-foreground group-hover:text-interactive"
                  )}
                />
              </span>
              <div className="min-w-0 flex flex-1 items-center gap-2 overflow-hidden">
                <span
                  className={cn(
                    "truncate text-label-13 font-semibold transition-colors duration-150 ease-geist",
                    selectedRenderId === renderId
                      ? "text-foreground"
                      : "text-foreground/78"
                  )}
                >
                  {item.name}
                </span>
                {item.description ? (
                  <>
                    <span className="flex-shrink-0 text-muted-foreground/30">
                      ·
                    </span>
                    <span className="truncate text-label-12 text-muted-foreground">
                      {item.description}
                    </span>
                  </>
                ) : null}
              </div>
            </button>
            <div className="absolute inset-y-0 right-3 flex items-center">
              <RowActionsMenu
                open={interaction.isMenuOpenForItem(renderId)}
                moreActionsLabel={moreActionsLabel}
                itemLabel={item.name}
                actions={[
                  createFavoriteConfigAction({
                    isFavorite: favoriteSet.has(item.key),
                    favoriteLabel,
                    unfavoriteLabel,
                    onSelect: () => onToggleFavoriteConfig(item.key),
                  }),
                  {
                    key: "removeRecent",
                    label: removeRecentLabel,
                    icon: <X className="size-3.5" />,
                    onSelect: () => onRemoveRecentConfig(item.key),
                    destructive: true,
                    separatorBefore: true,
                  },
                ]}
                onOpenChange={(open) => {
                  interaction.handleMenuOpenChange(renderId, open);
                }}
                stopPropagation
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
