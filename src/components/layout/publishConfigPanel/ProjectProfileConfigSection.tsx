import { type RefObject } from "react";
import { Copy, Eye, FileText, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { RowActionsMenu } from "@/components/layout/RowActionsMenu";
import { ListDragHandle } from "@/components/layout/ListReorderControls";
import { createFavoriteConfigAction } from "@/components/layout/publishConfigPanel/favoriteConfigAction";
import { configRowClass } from "@/components/layout/publishConfigPanel/configRowClass";
import { composeNodeRefs } from "@/components/layout/composeNodeRefs";
import { createProjectProfileConfigKey } from "@/features/config/publishConfigIdentity";
import type { PreferredSelectedRenderAnchor } from "@/components/layout/usePublishConfigListModel";
import { ConfigGroup } from "@/components/layout/publishConfigPanel/ConfigGroup";
import type { ProjectProfileViewerHandle } from "@/components/layout/publishConfigPanel/ProjectProfileViewer";
import type {
  ListInteractionController,
  RecentMotionController,
  RecentReorderController,
} from "@/components/layout/publishConfigPanel/RecentConfigSection";

/** 项目发布配置段（pubxml 行）：选择、收藏、复制为自定义、查看。 */
export interface ProjectProfileConfigSectionProps {
  profiles: string[];
  groupTitle: string;
  moreActionsLabel: string;
  favoriteLabel: string;
  unfavoriteLabel: string;
  copyConfigLabel: string;
  viewConfigLabel: string;
  dragToReorderLabel: string;
  dragDisabledWhileSearchingLabel: string;
  dragEnabled: boolean;
  isRefreshing: boolean;
  showLoadingState: boolean;
  refreshingLabel: string;
  reorder: RecentReorderController;
  motion: RecentMotionController;
  interaction: ListInteractionController;
  visualTargetConfigId: string | null;
  selectedRenderId: string | null;
  favoriteSet: Set<string>;
  onToggleFavoriteConfig: (configKey: string) => void;
  onSelectProfile: (name: string) => void;
  onCopyToCustom: (profileName: string) => void;
  viewerRef: RefObject<ProjectProfileViewerHandle | null>;
  selectedRepoScopeId: string | null;
  onSelectRenderAnchor: (anchor: PreferredSelectedRenderAnchor) => void;
}

export function ProjectProfileConfigSection({
  profiles,
  groupTitle,
  moreActionsLabel,
  favoriteLabel,
  unfavoriteLabel,
  copyConfigLabel,
  viewConfigLabel,
  dragToReorderLabel,
  dragDisabledWhileSearchingLabel,
  dragEnabled,
  isRefreshing,
  showLoadingState,
  refreshingLabel,
  reorder,
  motion,
  interaction,
  visualTargetConfigId,
  selectedRenderId,
  favoriteSet,
  onToggleFavoriteConfig,
  onSelectProfile,
  onCopyToCustom,
  viewerRef,
  selectedRepoScopeId,
  onSelectRenderAnchor,
}: ProjectProfileConfigSectionProps) {
  return (
    <ConfigGroup
      title={groupTitle}
      count={profiles.length}
      defaultExpanded={true}
      visible={profiles.length > 0 || showLoadingState}
      isRefreshing={isRefreshing}
      emptyState={
        showLoadingState ? (
          <span className="flex items-center gap-2">
            <span className="inline-block animate-spin text-interactive">
              <Loader2 className="size-3.5" />
            </span>
            {refreshingLabel}
          </span>
        ) : null
      }
    >
      {profiles.map((name) => {
        const configKey = createProjectProfileConfigKey(name);
        const isPubxmlSelected = selectedRenderId === configKey;
        return (
          <div
            key={`pubxml-${name}`}
            ref={composeNodeRefs(
              reorder.setItemRef(name, undefined),
              motion.setItemRef(name)
            )}
            data-list-row="true"
            data-list-item-id={configKey}
            data-list-visual-target={
              visualTargetConfigId === configKey ? "true" : "false"
            }
            data-list-menu-open={
              interaction.isMenuOpenForItem(configKey) ? "true" : "false"
            }
            className={cn(
              "group relative z-10",
              reorder.draggingItemId === name && "pointer-events-none z-40"
            )}
            style={
              reorder.draggingItemId === name
                ? reorder.dragPreviewStyle
                : undefined
            }
            onMouseEnter={() => interaction.handleRowMouseEnter(configKey)}
            onFocusCapture={() => interaction.handleRowFocus(configKey)}
            onBlurCapture={(event) => {
              const nextFocusTarget = event.relatedTarget;
              if (
                nextFocusTarget instanceof Node &&
                event.currentTarget.contains(nextFocusTarget)
              ) {
                return;
              }

              interaction.handleRowBlur(configKey);
            }}
          >
            <ListDragHandle
              visible={dragEnabled}
              enabled={dragEnabled}
              label={dragToReorderLabel}
              disabledLabel={dragDisabledWhileSearchingLabel}
              onPointerDown={(event) => {
                reorder.startDrag(name, event);
              }}
            />
            <button
              type="button"
              data-testid={`pubxml-select-${name}`}
              data-selected={isPubxmlSelected}
              aria-pressed={isPubxmlSelected}
              className={cn(configRowClass, dragEnabled ? "pl-10" : "pl-3")}
              onClick={() => {
                onSelectRenderAnchor({
                  repoId: selectedRepoScopeId,
                  renderId: configKey,
                });
                onSelectProfile(name);
              }}
            >
              <span
                className={cn(
                  "flex size-8 flex-shrink-0 items-center justify-center rounded-sm transition-colors duration-150 ease-geist",
                  isPubxmlSelected
                    ? "bg-interactive/10"
                    : "bg-muted group-hover:bg-interactive/10"
                )}
              >
                <FileText
                  className={cn(
                    "size-4 transition-colors duration-150 ease-geist",
                    isPubxmlSelected
                      ? "text-interactive"
                      : "text-muted-foreground group-hover:text-interactive"
                  )}
                />
              </span>
              <div className="min-w-0 flex flex-1 items-center gap-2 overflow-hidden">
                <span
                  className={cn(
                    "truncate text-label-13 font-semibold transition-colors duration-150 ease-geist",
                    isPubxmlSelected ? "text-foreground" : "text-foreground/78"
                  )}
                >
                  {name}
                </span>
              </div>
            </button>
            <div className="absolute inset-y-0 right-3 flex items-center">
              <RowActionsMenu
                open={interaction.isMenuOpenForItem(configKey)}
                moreActionsLabel={moreActionsLabel}
                itemLabel={name}
                actions={[
                  createFavoriteConfigAction({
                    isFavorite: favoriteSet.has(configKey),
                    favoriteLabel,
                    unfavoriteLabel,
                    onSelect: () => onToggleFavoriteConfig(configKey),
                  }),
                  {
                    key: "copy",
                    label: copyConfigLabel,
                    icon: <Copy className="size-3.5 text-muted-foreground" />,
                    onSelect: () => onCopyToCustom(name),
                  },
                  {
                    key: "view",
                    label: viewConfigLabel,
                    icon: <Eye className="size-3.5 text-muted-foreground" />,
                    onSelect: () => viewerRef.current?.viewProfile(name),
                  },
                ]}
                onOpenChange={(open) => {
                  interaction.handleMenuOpenChange(configKey, open);
                }}
                stopPropagation
              />
            </div>
          </div>
        );
      })}
    </ConfigGroup>
  );
}
