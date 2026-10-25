import { Loader2 } from "lucide-react";

import { type ConfigProfile } from "@/lib/store/types";
import type { ProfileGroupBucket } from "@/lib/listOrdering";
import { ProfileListItem } from "@/components/layout/publishConfigPanel/ProfileListItem";
import { ConfigGroup } from "@/components/layout/publishConfigPanel/ConfigGroup";
import { composeNodeRefs } from "@/components/layout/composeNodeRefs";
import { createUserProfileConfigKey } from "@/features/config/publishConfigIdentity";
import type { PreferredSelectedRenderAnchor } from "@/components/layout/usePublishConfigListModel";
import type { usePointerListReorder } from "@/components/layout/usePointerListReorder";
import type {
  ListInteractionController,
  RecentMotionController,
} from "@/components/layout/publishConfigPanel/RecentConfigSection";

/** 自定义配置段：分组渲染可编辑配置（查看/编辑/组合/发布设置/删除/拖拽排序）。 */
export interface CustomProfileConfigSectionProps {
  groups: ProfileGroupBucket[];
  compositionConfigLabel: string;
  releaseSettingsConfigLabel: string;
  viewConfigLabel: string;
  editConfigLabel: string;
  updateUnavailableLabel: string;
  deleteConfigLabel: string;
  deleteBlockedLabel: string;
  configurationBlockedLabel: string;
  favoriteConfigLabel: string;
  unfavoriteConfigLabel: string;
  moreActionsLabel: string;
  dragToReorderLabel: string;
  dragDisabledWhileSearchingLabel: string;
  dragEnabled: boolean;
  showLoadingState: boolean;
  refreshingLabel: string;
  reorder: ReturnType<typeof usePointerListReorder<{ groupKey: string }>>;
  motion: RecentMotionController;
  interaction: ListInteractionController;
  visualTargetConfigId: string | null;
  selectedRenderId: string | null;
  favoriteSet: Set<string>;
  onToggleFavoriteConfig: (configKey: string) => void;
  onSelectProfile: (profile: ConfigProfile) => void;
  onViewProfile: (profile: ConfigProfile) => void;
  onEditProfile: (profile: ConfigProfile) => void;
  onEditComposition: (profile: ConfigProfile) => void;
  onEditReleaseSettings: (profile: ConfigProfile) => void;
  onDelete: (profile: ConfigProfile) => void;
  selectedRepoScopeId: string | null;
  onSelectRenderAnchor: (anchor: PreferredSelectedRenderAnchor) => void;
}

export function CustomProfileConfigSection({
  groups,
  compositionConfigLabel,
  releaseSettingsConfigLabel,
  viewConfigLabel,
  editConfigLabel,
  updateUnavailableLabel,
  deleteConfigLabel,
  deleteBlockedLabel,
  configurationBlockedLabel,
  favoriteConfigLabel,
  unfavoriteConfigLabel,
  moreActionsLabel,
  dragToReorderLabel,
  dragDisabledWhileSearchingLabel,
  dragEnabled,
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
  onViewProfile,
  onEditProfile,
  onEditComposition,
  onEditReleaseSettings,
  onDelete,
  selectedRepoScopeId,
  onSelectRenderAnchor,
}: CustomProfileConfigSectionProps) {
  return (
    <>
      {groups.map((group) => (
        <ConfigGroup
          key={`userprofile-group-${group.groupName}`}
          title={group.groupName}
          count={group.items.length}
          defaultExpanded={true}
          visible={true}
        >
          {group.items.map((profile) => {
            const configKey = createUserProfileConfigKey(profile.id);
            const blockedReason =
              profile.externalBindingIds.length > 0
                ? `${profile.externalBindingIds.length} 个外部绑定仍在引用此配置`
                : "";
            return (
              <ProfileListItem
                key={profile.id}
                profile={profile}
                configKey={configKey}
                configId={configKey}
                isSelected={selectedRenderId === configKey}
                isVisualTarget={visualTargetConfigId === configKey}
                isFavorite={favoriteSet.has(configKey)}
                isMenuOpen={interaction.isMenuOpenForItem(configKey)}
                onClick={() => {
                  onSelectRenderAnchor({
                    repoId: selectedRepoScopeId,
                    renderId: configKey,
                  });
                  onSelectProfile(profile);
                }}
                onToggleFavorite={onToggleFavoriteConfig}
                onView={() => onViewProfile(profile)}
                onEdit={() => onEditProfile(profile)}
                onEditComposition={() => onEditComposition(profile)}
                compositionTitle={compositionConfigLabel}
                onEditReleaseSettings={
                  profile.providerId === "tauri"
                    ? () => onEditReleaseSettings(profile)
                    : undefined
                }
                releaseSettingsTitle={releaseSettingsConfigLabel}
                canEdit={!profile.isSystemDefault}
                viewTitle={viewConfigLabel}
                editTitle={editConfigLabel}
                updateUnavailableTitle={updateUnavailableLabel}
                deleteTitle={deleteConfigLabel}
                blockedDeleteTitle={deleteBlockedLabel.replace(
                  "{{reason}}",
                  blockedReason
                )}
                blockedStatusTitle={configurationBlockedLabel.replace(
                  "{{reason}}",
                  profile.blockedReason || ""
                )}
                favoriteLabel={favoriteConfigLabel}
                unfavoriteLabel={unfavoriteConfigLabel}
                moreActionsLabel={moreActionsLabel}
                onDelete={() => onDelete(profile)}
                onMenuOpenChange={(open) => {
                  interaction.handleMenuOpenChange(configKey, open);
                }}
                rowRef={composeNodeRefs(
                  reorder.setItemRef(profile.id, {
                    groupKey: group.groupKey,
                  }),
                  motion.setItemRef(profile.id)
                )}
                onItemMouseEnter={() =>
                  interaction.handleRowMouseEnter(configKey)
                }
                onItemFocus={() => interaction.handleRowFocus(configKey)}
                onItemBlur={() => interaction.handleRowBlur(configKey)}
                groupKey={group.groupKey}
                dragEnabled={dragEnabled}
                dragHandleVisible={dragEnabled}
                dragHandleLabel={dragToReorderLabel}
                dragDisabledLabel={dragDisabledWhileSearchingLabel}
                isDragging={reorder.draggingItemId === profile.id}
                dragPreviewStyle={reorder.dragPreviewStyle}
                onHandlePointerDown={reorder.startDrag}
              />
            );
          })}
        </ConfigGroup>
      ))}
      {showLoadingState ? (
        <div className="flex items-center gap-2 px-3 py-4 text-label-12 text-muted-foreground">
          <span className="inline-block animate-spin text-interactive">
            <Loader2 className="size-3.5" />
          </span>
          <span>{refreshingLabel}</span>
        </div>
      ) : null}
    </>
  );
}
