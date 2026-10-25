import {
  useCallback,
  useRef,
  useState,
  useMemo,
  memo,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { cn } from "@/lib/utils";
import { reorderItemsByDrop, reorderProfilesByDrop } from "@/lib/listOrdering";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Terminal,
  Search,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Folder,
  FileText,
  Check,
  ChevronDown,
  ArrowUpDown,
} from "lucide-react";
import { toast } from "sonner";
import { type ConfigProfile } from "@/lib/store/types";
import type { ParameterValue } from "@/types/parameters";
import type { PublishComposition } from "@/generated/tauri-contracts";
import { CompositionEditorDialog } from "@/components/publish/CompositionEditorDialog";
import { ReleaseSettingsEditorDialog } from "@/components/publish/ReleaseSettingsEditorDialog";
import { DeleteProfileConfirmDialog } from "@/components/publish/DeleteProfileConfirmDialog";
import { resolveDotnetProjectProfile } from "@/lib/dotnetProjectProfile";
import { localizeInvokeError } from "@/lib/tauri/invokeErrors";
import {
  createProjectProfileConfigKey,
  createRecentConfigRenderId,
  createUserProfileConfigKey,
  getProjectProfileNameFromRenderId,
  getRecentConfigKeyFromRenderId,
  getUserProfileIdFromRenderId,
} from "@/features/config/publishConfigIdentity";
import { useI18n } from "@/hooks/useI18n";
import { topbarIconButtonClass } from "@/components/layout/topbarButtonStyles";
import { usePointerListReorder } from "@/components/layout/usePointerListReorder";
import { useListInteractionState } from "@/components/layout/useListInteractionState";
import { useListReorderMotion } from "@/components/layout/useListReorderMotion";
import { useListDropSettledState } from "@/components/layout/useListDropSettledState";
import {
  ALL_GROUP_FILTER,
  type GroupFilterValue,
  type PreferredSelectedRenderAnchor,
  usePublishConfigListModel,
  usePublishConfigPreviewModel,
} from "@/components/layout/usePublishConfigListModel";
import type { ParameterSchema } from "@/types/parameters";
import { CollapseIcon } from "@/components/layout/publishConfigPanel/CollapseIcon";
import { AutomationBindingsSection } from "@/components/publish/AutomationBindingsSection";
import {
  hasSameProfileOrder,
  hasSameStringOrder,
} from "@/components/layout/publishConfigPanel/listOrderComparisons";
import { RecentConfigSection } from "@/components/layout/publishConfigPanel/RecentConfigSection";
import { ProjectProfileConfigSection } from "@/components/layout/publishConfigPanel/ProjectProfileConfigSection";
import { CustomProfileConfigSection } from "@/components/layout/publishConfigPanel/CustomProfileConfigSection";
import type { PublishSelectionRef } from "@/generated/tauri-contracts";
import {
  ProjectProfileViewer,
  type ProjectProfileViewerHandle,
} from "@/components/layout/publishConfigPanel/ProjectProfileViewer";

const EMPTY_FRAMEWORK_OPTIONS: string[] = [];

export interface PublishConfigPanelProps {
  selectedRepoId?: string | null;
  selection: PublishSelectionRef | null | undefined;
  profiles: ConfigProfile[];
  isProfilesRefreshing?: boolean;
  activeProfileName: string | null;
  onSelectProfile: (profile: ConfigProfile) => void;
  onCreateProfile: () => void;
  onImportCommand?: () => void;
  onEditProfile: (profile: ConfigProfile) => void;
  onViewProfile: (profile: ConfigProfile) => void;
  onSaveProfileComposition: (
    profile: ConfigProfile,
    composition: PublishComposition
  ) => Promise<void>;
  onRebindProfileProject: (profile: ConfigProfile) => Promise<void>;
  onRefreshProfiles: () => void;
  onOpenConfigDialog: () => void;
  onDeleteProfile: (profileId: string) => void | Promise<void>;
  dotnetSchema?: ParameterSchema;
  projectPublishProfiles: string[];
  isProjectProfilesRefreshing?: boolean;
  projectFilePath?: string;
  projectFrameworkOptions?: string[];
  onSelectProjectProfile: (profileName: string) => void;
  onCopyProjectProfileToCustom: (
    sourceProfileName: string,
    parameters: Record<string, ParameterValue>
  ) => Promise<string>;
  recentConfigKeys: string[];
  favoriteConfigKeys: string[];
  onToggleFavoriteConfig: (configKey: string) => void;
  onRemoveRecentConfig: (configKey: string) => void;
  onReorderRecentConfigs: (configKeys: string[]) => void;
  onReorderProjectProfiles: (profileNames: string[]) => void;
  onReorderProfiles: (profiles: ConfigProfile[]) => void;
  onCollapse?: () => void;
  showExpandButton?: boolean;
  onExpandRepo?: () => void;
}

export const PublishConfigPanel = memo(function PublishConfigPanel({
  selectedRepoId,
  selection,
  profiles,
  isProfilesRefreshing = false,
  activeProfileName,
  onSelectProfile,
  onCreateProfile,
  onImportCommand,
  onEditProfile,
  onViewProfile,
  onSaveProfileComposition,
  onRebindProfileProject,
  onRefreshProfiles,
  onOpenConfigDialog,
  onDeleteProfile,
  dotnetSchema,
  projectPublishProfiles,
  isProjectProfilesRefreshing = false,
  projectFilePath,
  projectFrameworkOptions = EMPTY_FRAMEWORK_OPTIONS,
  onSelectProjectProfile,
  onCopyProjectProfileToCustom,
  recentConfigKeys,
  favoriteConfigKeys,
  onToggleFavoriteConfig,
  onRemoveRecentConfig,
  onReorderRecentConfigs,
  onReorderProjectProfiles,
  onReorderProfiles,
  onCollapse,
  showExpandButton,
  onExpandRepo,
}: PublishConfigPanelProps) {
  const selectedRepoScopeId = selectedRepoId ?? null;
  const [searchQuery, setSearchQuery] = useState("");
  const [groupFilterValue, setGroupFilterValue] =
    useState<GroupFilterValue>(ALL_GROUP_FILTER);
  const [groupFilterOpen, setGroupFilterOpen] = useState(false);
  const [preferredSelectedRenderAnchor, setPreferredSelectedRenderAnchor] =
    useState<PreferredSelectedRenderAnchor | null>(null);
  const [showReorderControls, setShowReorderControls] = useState(false);
  const [compositionProfile, setCompositionProfile] =
    useState<ConfigProfile | null>(null);
  // ADR-0060：Tauri 发布设置的过渡期表单。
  const [releaseSettingsProfile, setReleaseSettingsProfile] =
    useState<ConfigProfile | null>(null);
  const [pendingDeleteProfile, setPendingDeleteProfile] =
    useState<ConfigProfile | null>(null);
  // 决议 #91：安装向导拉起编辑器时预填 github-actions（仅表单初值）。
  const [compositionPresetBackendId, setCompositionPresetBackendId] = useState<
    string | null
  >(null);
  const projectProfileViewerRef = useRef<ProjectProfileViewerHandle>(null);
  const { translations } = useI18n();
  const t = translations.configPanel || {};
  const commonT = translations.common || {};
  const defaultGroupName = t.defaultProfileGroup || "默认分组";
  const configManagementLabel =
    translations.settings?.categories?.config ||
    translations.profiles?.title ||
    "配置管理";
  const allConfigsLabel =
    t.allConfigs || translations.repositoryList?.all || "全部";
  const moreActionsLabel =
    t.moreActions || translations.repositoryList?.moreActions || "更多操作";
  const favoriteConfigLabel = t.favoriteConfig || "收藏配置";
  const unfavoriteConfigLabel = t.unfavoriteConfig || "取消收藏";
  const removeRecentLabel = t.removeRecent || "从最近使用移除";
  const deleteConfigLabel = t.deleteConfig || "删除配置";
  const deleteBlockedLabel =
    t.deleteBlocked || "删除受阻：{{reason}}。请先更新配置处理绑定";
  const recentlyUsedLabel = t.recentlyUsed || "最近使用";
  const dragToReorderLabel = t.dragToReorder || "拖动排序";
  const dragDisabledWhileSearchingLabel =
    t.dragDisabledWhileSearching || "搜索时无法排序";
  const profileGroupLabel = t.profileGroup || "项目发布配置";
  const copyConfigLabel = t.copyConfig || "复制为自定义配置";
  const viewConfigLabel = t.viewConfig || "查看配置";
  const editConfigLabel = t.updateConfig || t.editConfig || "更新配置";
  const updateUnavailableLabel =
    t.updateUnavailable || "更新配置（当前 Provider 暂无可用编辑器）";
  const compositionConfigLabel = t.compositionConfig || "发布组合";
  const releaseSettingsConfigLabel = t.releaseSettingsConfig || "发布设置";
  const configurationBlockedLabel =
    t.configurationBlocked || "配置不可执行：{{reason}}";
  const noConfigsLabel = t.noConfigs || "暂无配置";
  const projectProfilesRefreshingLabel =
    t.refreshingProjectProfiles || "正在刷新项目发布配置…";
  const customProfilesRefreshingLabel =
    t.refreshingCustomProfiles || "正在刷新自定义配置…";
  const isAnyRefreshing = isProfilesRefreshing || isProjectProfilesRefreshing;
  const listActionButtonClass =
    "flex size-7 items-center justify-center rounded-full border border-border bg-background transition-colors duration-150 ease-geist hover:bg-gray-alpha-100 focus-ring";
  const reorderControlsLabel = showReorderControls
    ? t.hideReorderControls || "关闭排序"
    : t.showReorderControls || "开启排序";

  const {
    query,
    favoriteSet,
    recentItems,
    groupFilterOptions,
    selectedGroupFilterOption,
    visibleProjectProfiles,
    visibleConfigCount,
    showRecentItems,
    recentDragEnabled,
    projectProfileDragEnabled,
    customProfileDragEnabled,
    shouldShowProjectProfilesLoadingState,
    shouldShowCustomProfilesLoadingState,
    selectedConfigId,
    allConfigIds,
    selectedRenderId,
  } = usePublishConfigListModel({
    selectedRepoScopeId,
    selection,
    activeProfileName,
    profiles,
    projectPublishProfiles,
    recentConfigKeys,
    favoriteConfigKeys,
    searchQuery,
    groupFilterValue,
    onGroupFilterValueChange: setGroupFilterValue,
    defaultGroupName,
    allConfigsLabel,
    projectProfilesLabel: t.profileGroup || "项目发布配置",
    preferredSelectedRenderAnchor,
    showReorderControls,
    isProfilesRefreshing,
    isProjectProfilesRefreshing,
  });

  const interaction = useListInteractionState({
    filteredItemIds: allConfigIds,
    selectedItemId: selectedRenderId,
    resetKey: selectedRepoId ?? null,
  });
  const {
    settledItemId: settledConfigRenderId,
    clearSettledItem: clearSettledConfigRenderId,
    settleFromDragEnd: settleConfigFromDragEnd,
    shouldIgnorePointerReentry: shouldIgnoreConfigPointerReentry,
  } = useListDropSettledState<string>({
    resetKey: selectedRepoScopeId,
  });
  const handleConfigListPointerReentry = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      return shouldIgnoreConfigPointerReentry({
        x: event.clientX,
        y: event.clientY,
      });
    },
    [shouldIgnoreConfigPointerReentry]
  );
  const handleConfigListPointerLeave = useCallback(() => {
    clearSettledConfigRenderId();
  }, [clearSettledConfigRenderId]);
  const recentReorder = usePointerListReorder<undefined>({
    enabled: recentDragEnabled,
    onStart: () => {
      clearSettledConfigRenderId();
      interaction.handleListPointerLeave();
    },
    onEnd: (result) => {
      settleConfigFromDragEnd(result, (itemId) =>
        createRecentConfigRenderId(itemId)
      );
    },
    onCommit: (activeConfigKey, target) => {
      const nextConfigKeys = reorderItemsByDrop(
        recentConfigKeys,
        (item) => item,
        activeConfigKey,
        target.itemId,
        target.position
      );

      if (hasSameStringOrder(nextConfigKeys, recentConfigKeys)) {
        return;
      }

      onReorderRecentConfigs(nextConfigKeys);
    },
  });

  const projectProfileReorder = usePointerListReorder<undefined>({
    enabled: projectProfileDragEnabled,
    onStart: () => {
      clearSettledConfigRenderId();
      interaction.handleListPointerLeave();
    },
    onEnd: (result) => {
      settleConfigFromDragEnd(result, (itemId) =>
        createProjectProfileConfigKey(itemId)
      );
    },
    onCommit: (activeProfileName, target) => {
      const nextProfileNames = reorderItemsByDrop(
        visibleProjectProfiles,
        (item) => item,
        activeProfileName,
        target.itemId,
        target.position
      );

      if (hasSameStringOrder(nextProfileNames, visibleProjectProfiles)) {
        return;
      }

      onReorderProjectProfiles(nextProfileNames);
    },
  });

  const customProfileReorder = usePointerListReorder<{ groupKey: string }>({
    enabled: customProfileDragEnabled,
    onStart: () => {
      clearSettledConfigRenderId();
      interaction.handleListPointerLeave();
    },
    onEnd: (result) => {
      settleConfigFromDragEnd(result, (itemId) =>
        createUserProfileConfigKey(itemId)
      );
    },
    onCommit: (activeProfileId, target) => {
      const nextProfiles = reorderProfilesByDrop({
        profiles,
        activeProfileId,
        targetProfileId: target.itemId,
        targetGroupKey: target.meta.groupKey,
        position: target.position,
        defaultGroupName,
      });

      if (hasSameProfileOrder(nextProfiles, profiles)) {
        return;
      }

      onReorderProfiles(nextProfiles);
    },
  });
  const previewRecentItems = useMemo(
    () =>
      recentReorder.draggingItemId && recentReorder.dropTarget
        ? reorderItemsByDrop(
            recentItems,
            (item) => item.key,
            recentReorder.draggingItemId,
            recentReorder.dropTarget.itemId,
            recentReorder.dropTarget.position
          )
        : recentItems,
    [recentItems, recentReorder.draggingItemId, recentReorder.dropTarget]
  );
  const previewProjectProfiles = useMemo(
    () =>
      projectProfileReorder.draggingItemId && projectProfileReorder.dropTarget
        ? reorderItemsByDrop(
            visibleProjectProfiles,
            (item) => item,
            projectProfileReorder.draggingItemId,
            projectProfileReorder.dropTarget.itemId,
            projectProfileReorder.dropTarget.position
          )
        : visibleProjectProfiles,
    [
      projectProfileReorder.draggingItemId,
      projectProfileReorder.dropTarget,
      visibleProjectProfiles,
    ]
  );
  const previewProfiles = useMemo(
    () =>
      customProfileReorder.draggingItemId && customProfileReorder.dropTarget
        ? reorderProfilesByDrop({
            profiles,
            activeProfileId: customProfileReorder.draggingItemId,
            targetProfileId: customProfileReorder.dropTarget.itemId,
            targetGroupKey: customProfileReorder.dropTarget.meta.groupKey,
            position: customProfileReorder.dropTarget.position,
            defaultGroupName,
          })
        : profiles,
    [
      customProfileReorder.draggingItemId,
      customProfileReorder.dropTarget,
      defaultGroupName,
      profiles,
    ]
  );
  const {
    previewVisibleProjectProfiles,
    previewVisibleGroupedFilteredProfiles,
    shouldShowEmptyState,
  } = usePublishConfigPreviewModel({
    query,
    groupFilterValue,
    defaultGroupName,
    showRecentItems,
    previewRecentItems,
    previewProjectProfiles,
    previewProfiles,
    shouldShowProjectProfilesLoadingState,
    shouldShowCustomProfilesLoadingState,
  });
  const recentMotion = useListReorderMotion({
    orderedIds: previewRecentItems.map((item) => item.key),
    draggingItemId: recentReorder.draggingItemId,
    settledItemId: getRecentConfigKeyFromRenderId(settledConfigRenderId),
    resetKey: selectedRepoScopeId,
  });
  const projectMotion = useListReorderMotion({
    orderedIds: previewProjectProfiles,
    draggingItemId: projectProfileReorder.draggingItemId,
    settledItemId: getProjectProfileNameFromRenderId(settledConfigRenderId),
    resetKey: selectedRepoScopeId,
  });
  const customMotion = useListReorderMotion({
    orderedIds: previewProfiles.map((profile) => profile.id),
    draggingItemId: customProfileReorder.draggingItemId,
    settledItemId: getUserProfileIdFromRenderId(settledConfigRenderId),
    resetKey: selectedRepoScopeId,
  });
  const draggingConfigRenderId = useMemo(() => {
    if (recentReorder.draggingItemId) {
      return createRecentConfigRenderId(recentReorder.draggingItemId);
    }

    if (projectProfileReorder.draggingItemId) {
      return createProjectProfileConfigKey(
        projectProfileReorder.draggingItemId
      );
    }

    if (customProfileReorder.draggingItemId) {
      return createUserProfileConfigKey(customProfileReorder.draggingItemId);
    }

    return null;
  }, [
    customProfileReorder.draggingItemId,
    projectProfileReorder.draggingItemId,
    recentReorder.draggingItemId,
  ]);
  const visualTargetConfigId =
    draggingConfigRenderId ??
    settledConfigRenderId ??
    interaction.visualTargetItemId;

  const handleCopyProjectProfileToCustom = useCallback(
    async (profileName: string) => {
      if (!projectFilePath) {
        const errorMessage =
          t.copyConfigFailedDescription ||
          "当前项目文件路径不可用，无法复制发布配置。";
        toast.error(t.copyConfigFailed || "复制为自定义配置失败", {
          description: errorMessage,
        });
        return;
      }

      try {
        const resolvedProfile = await resolveDotnetProjectProfile({
          projectInfo: {
            root_path: "",
            project_file: projectFilePath,
            target_frameworks: projectFrameworkOptions,
          },
          profileName,
        });

        const createdProfileName = await onCopyProjectProfileToCustom(
          resolvedProfile.profileName,
          resolvedProfile.parameters
        );
        toast.success(t.copyConfigSuccess || "已复制为自定义配置", {
          description: (
            t.copyConfigSuccessDescription ||
            "已根据项目发布配置生成可编辑的自定义配置：{{name}}"
          ).replace("{{name}}", createdProfileName),
        });
      } catch (error) {
        toast.error(t.copyConfigFailed || "复制为自定义配置失败", {
          description: localizeInvokeError(error, translations),
        });
      }
    },
    [
      onCopyProjectProfileToCustom,
      projectFilePath,
      projectFrameworkOptions,
      t.copyConfigFailed,
      t.copyConfigFailedDescription,
      t.copyConfigSuccess,
      t.copyConfigSuccessDescription,
      translations,
    ]
  );

  const handleSelectRecentItem = useCallback(
    (item: (typeof recentItems)[number]) => {
      if (item.kind === "pubxml") {
        onSelectProjectProfile(item.name);
        return;
      }

      if (item.profile) {
        onSelectProfile(item.profile);
      }
    },
    [onSelectProfile, onSelectProjectProfile]
  );

  const configListContent = useMemo(() => {
    return (
      <div
        className="list-scroll-shell geist-scrollbar relative flex-1 overflow-auto px-2 py-2"
        onPointerEnter={(event) => {
          if (handleConfigListPointerReentry(event)) {
            return;
          }
          clearSettledConfigRenderId();
          interaction.handleListPointerEnter();
        }}
        onPointerLeave={() => {
          handleConfigListPointerLeave();
          interaction.handleListPointerLeave();
        }}
      >
        <div>
          {showRecentItems && (
            <RecentConfigSection
              items={previewRecentItems}
              recentlyUsedLabel={recentlyUsedLabel}
              moreActionsLabel={moreActionsLabel}
              favoriteLabel={favoriteConfigLabel}
              unfavoriteLabel={unfavoriteConfigLabel}
              removeRecentLabel={removeRecentLabel}
              dragToReorderLabel={dragToReorderLabel}
              dragDisabledWhileSearchingLabel={dragDisabledWhileSearchingLabel}
              dragEnabled={recentDragEnabled}
              reorder={recentReorder}
              motion={recentMotion}
              interaction={interaction}
              visualTargetConfigId={visualTargetConfigId}
              selectedConfigId={selectedConfigId}
              selectedRenderId={selectedRenderId}
              favoriteSet={favoriteSet}
              onToggleFavoriteConfig={onToggleFavoriteConfig}
              onRemoveRecentConfig={onRemoveRecentConfig}
              onSelectItem={handleSelectRecentItem}
              selectedRepoScopeId={selectedRepoScopeId}
              onSelectRenderAnchor={setPreferredSelectedRenderAnchor}
            />
          )}
          <ProjectProfileConfigSection
            profiles={previewVisibleProjectProfiles}
            groupTitle={profileGroupLabel}
            moreActionsLabel={moreActionsLabel}
            favoriteLabel={favoriteConfigLabel}
            unfavoriteLabel={unfavoriteConfigLabel}
            copyConfigLabel={copyConfigLabel}
            viewConfigLabel={viewConfigLabel}
            dragToReorderLabel={dragToReorderLabel}
            dragDisabledWhileSearchingLabel={dragDisabledWhileSearchingLabel}
            dragEnabled={projectProfileDragEnabled}
            isRefreshing={isProjectProfilesRefreshing}
            showLoadingState={shouldShowProjectProfilesLoadingState}
            refreshingLabel={projectProfilesRefreshingLabel}
            reorder={projectProfileReorder}
            motion={projectMotion}
            interaction={interaction}
            visualTargetConfigId={visualTargetConfigId}
            selectedRenderId={selectedRenderId}
            favoriteSet={favoriteSet}
            onToggleFavoriteConfig={onToggleFavoriteConfig}
            onSelectProfile={onSelectProjectProfile}
            onCopyToCustom={handleCopyProjectProfileToCustom}
            viewerRef={projectProfileViewerRef}
            selectedRepoScopeId={selectedRepoScopeId}
            onSelectRenderAnchor={setPreferredSelectedRenderAnchor}
          />
          <CustomProfileConfigSection
            groups={previewVisibleGroupedFilteredProfiles}
            compositionConfigLabel={compositionConfigLabel}
            releaseSettingsConfigLabel={releaseSettingsConfigLabel}
            viewConfigLabel={viewConfigLabel}
            editConfigLabel={editConfigLabel}
            updateUnavailableLabel={updateUnavailableLabel}
            deleteConfigLabel={deleteConfigLabel}
            deleteBlockedLabel={deleteBlockedLabel}
            configurationBlockedLabel={configurationBlockedLabel}
            favoriteConfigLabel={favoriteConfigLabel}
            unfavoriteConfigLabel={unfavoriteConfigLabel}
            moreActionsLabel={moreActionsLabel}
            dragToReorderLabel={dragToReorderLabel}
            dragDisabledWhileSearchingLabel={dragDisabledWhileSearchingLabel}
            dragEnabled={customProfileDragEnabled}
            showLoadingState={shouldShowCustomProfilesLoadingState}
            refreshingLabel={customProfilesRefreshingLabel}
            reorder={customProfileReorder}
            motion={customMotion}
            interaction={interaction}
            visualTargetConfigId={visualTargetConfigId}
            selectedRenderId={selectedRenderId}
            favoriteSet={favoriteSet}
            onToggleFavoriteConfig={onToggleFavoriteConfig}
            onSelectProfile={onSelectProfile}
            onViewProfile={onViewProfile}
            onEditProfile={onEditProfile}
            onEditComposition={setCompositionProfile}
            onEditReleaseSettings={setReleaseSettingsProfile}
            onDelete={setPendingDeleteProfile}
            selectedRepoScopeId={selectedRepoScopeId}
            onSelectRenderAnchor={setPreferredSelectedRenderAnchor}
          />
          {shouldShowEmptyState && (
            <EmptyState
              icon={FileText}
              title={noConfigsLabel}
              className="py-10"
            />
          )}
        </div>
      </div>
    );
    // 依赖保持成员级：reorder/motion/interaction 对象本身每渲染新建，
    // 其方法引用稳定、状态值已按成员列出，整对象入依赖会让 memo 失效。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    deleteBlockedLabel,
    deleteConfigLabel,
    favoriteSet,
    favoriteConfigLabel,
    handleConfigListPointerLeave,
    handleConfigListPointerReentry,
    handleSelectRecentItem,
    customProfileDragEnabled,
    customProfilesRefreshingLabel,
    customMotion,
    onEditProfile,
    onRemoveRecentConfig,
    onSelectProfile,
    onSelectProjectProfile,
    onToggleFavoriteConfig,
    isProjectProfilesRefreshing,
    projectProfileDragEnabled,
    projectProfilesRefreshingLabel,
    projectMotion,
    projectProfileReorder.draggingItemId,
    projectProfileReorder.dragPreviewStyle,
    projectProfileReorder.setItemRef,
    projectProfileReorder.startDrag,
    previewRecentItems,
    previewVisibleGroupedFilteredProfiles,
    previewVisibleProjectProfiles,
    recentDragEnabled,
    recentMotion,
    recentReorder.draggingItemId,
    recentReorder.dragPreviewStyle,
    recentReorder.setItemRef,
    recentReorder.startDrag,
    removeRecentLabel,
    selectedConfigId,
    selectedRepoScopeId,
    selectedRenderId,
    showRecentItems,
    shouldShowCustomProfilesLoadingState,
    shouldShowEmptyState,
    shouldShowProjectProfilesLoadingState,
    moreActionsLabel,
    unfavoriteConfigLabel,
    handleCopyProjectProfileToCustom,
    interaction.handleListPointerEnter,
    interaction.handleListPointerLeave,
    interaction.handleMenuOpenChange,
    interaction.handleRowBlur,
    interaction.handleRowFocus,
    interaction.handleRowMouseEnter,
    interaction.isMenuOpenForItem,
    customProfileReorder.draggingItemId,
    customProfileReorder.dragPreviewStyle,
    customProfileReorder.setItemRef,
    customProfileReorder.startDrag,
    copyConfigLabel,
    clearSettledConfigRenderId,
    dragDisabledWhileSearchingLabel,
    dragToReorderLabel,
    editConfigLabel,
    updateUnavailableLabel,
    compositionConfigLabel,
    releaseSettingsConfigLabel,
    configurationBlockedLabel,
    noConfigsLabel,
    profileGroupLabel,
    recentlyUsedLabel,
    visualTargetConfigId,
    viewConfigLabel,
  ]);

  return (
    <div className="flex h-full flex-col">
      {/* Header with action buttons */}
      <div
        data-tauri-drag-region
        className={cn(
          "flex h-10 items-center justify-end px-2",
          showExpandButton && "pl-[100px]"
        )}
      >
        <div className="flex items-center gap-0.5" data-tauri-no-drag>
          {showExpandButton && onExpandRepo && (
            <Button
              variant="ghost"
              size="icon"
              className={topbarIconButtonClass}
              onClick={(e) => {
                e.stopPropagation();
                onExpandRepo();
              }}
              title={t.expandRepoList || "展开仓库列表"}
              aria-label={t.expandRepoList || "展开仓库列表"}
              data-tauri-no-drag
            >
              <Folder className="size-4" />
            </Button>
          )}
          {onCollapse && (
            <Button
              variant="ghost"
              size="icon"
              className={cn(topbarIconButtonClass, "group [&_svg]:!stroke-[1]")}
              onClick={(e) => {
                e.stopPropagation();
                onCollapse();
              }}
              title={t.collapsePanel || "收起面板"}
              aria-label={t.collapsePanel || "收起面板"}
              data-tauri-no-drag
            >
              <CollapseIcon />
            </Button>
          )}
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between px-3 py-2">
          <DropdownMenu
            open={groupFilterOpen}
            onOpenChange={setGroupFilterOpen}
          >
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-button-14 font-normal transition-colors duration-150 ease-geist hover:bg-gray-alpha-100 focus-ring"
                aria-haspopup="menu"
                aria-expanded={groupFilterOpen}
              >
                <span className="text-foreground">
                  {selectedGroupFilterOption?.label || allConfigsLabel}
                </span>
                <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-interactive/10 px-1 text-label-12 font-semibold text-interactive">
                  {visibleConfigCount}
                </span>
                <ChevronDown
                  className={cn(
                    "size-3 text-muted-foreground/60 transition-transform duration-150 ease-geist",
                    groupFilterOpen ? "" : "-rotate-90"
                  )}
                />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              sideOffset={8}
              className="min-w-[13rem]"
            >
              <DropdownMenuItem
                onSelect={() => setGroupFilterValue(ALL_GROUP_FILTER)}
                className={cn(
                  "justify-between gap-3",
                  groupFilterValue === ALL_GROUP_FILTER && "bg-accent"
                )}
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="truncate">{allConfigsLabel}</span>
                  <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-interactive/10 px-1 text-label-12 font-semibold text-interactive">
                    {groupFilterOptions[0]?.count ?? 0}
                  </span>
                </div>
                {groupFilterValue === ALL_GROUP_FILTER ? (
                  <Check className="size-3.5 text-interactive" />
                ) : null}
              </DropdownMenuItem>
              {groupFilterOptions.length > 1 ? <DropdownMenuSeparator /> : null}
              {groupFilterOptions.slice(1).map((option) => (
                <DropdownMenuItem
                  key={option.value}
                  onSelect={() => setGroupFilterValue(option.value)}
                  className={cn(
                    "justify-between gap-3",
                    groupFilterValue === option.value && "bg-accent"
                  )}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="truncate">{option.label}</span>
                    <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-interactive/10 px-1 text-label-12 font-semibold text-interactive">
                      {option.count}
                    </span>
                  </div>
                  {groupFilterValue === option.value ? (
                    <Check className="size-3.5 text-interactive" />
                  ) : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="flex items-center gap-1.5">
            {onImportCommand ? (
              <button
                type="button"
                className={listActionButtonClass}
                onClick={onImportCommand}
                title={t.importCommand || "从命令创建配置"}
                aria-label={t.importCommand || "从命令创建配置"}
                data-tauri-no-drag
              >
                <Terminal className="size-3.5" />
              </button>
            ) : null}
            <button
              type="button"
              className={listActionButtonClass}
              data-testid="new-config-btn"
              onClick={(e) => {
                e.stopPropagation();
                onCreateProfile();
              }}
              title={t.newConfig || "新建配置"}
              data-tauri-no-drag
            >
              <Plus className="size-3.5 text-muted-foreground transition-transform duration-150 ease-geist hover:rotate-90" />
            </button>
            <button
              type="button"
              className={cn(
                listActionButtonClass,
                showReorderControls && "bg-accent"
              )}
              onClick={(e) => {
                e.stopPropagation();
                setShowReorderControls((value) => !value);
              }}
              title={reorderControlsLabel}
              aria-label={reorderControlsLabel}
              aria-pressed={showReorderControls}
              data-tauri-no-drag
            >
              <ArrowUpDown
                className={cn(
                  "size-3.5 transition-[transform,color] duration-150 ease-geist",
                  showReorderControls
                    ? "rotate-180 hover:rotate-[360deg] text-interactive"
                    : "rotate-0 hover:rotate-180 text-muted-foreground"
                )}
              />
            </button>
            <button
              type="button"
              className={listActionButtonClass}
              onClick={(e) => {
                e.stopPropagation();
                onRefreshProfiles();
              }}
              title={t.refresh || "刷新配置"}
              data-tauri-no-drag
            >
              <RefreshCw
                className={cn(
                  "size-3.5 text-muted-foreground transition-transform duration-150 ease-geist hover:rotate-180",
                  isAnyRefreshing && "animate-spin hover:rotate-0"
                )}
              />
            </button>
            <button
              type="button"
              className={listActionButtonClass}
              data-testid="config-management-btn"
              onClick={(e) => {
                e.stopPropagation();
                onOpenConfigDialog();
              }}
              title={configManagementLabel}
              aria-label={configManagementLabel}
              data-tauri-no-drag
            >
              <SlidersHorizontal className="size-3.5 text-muted-foreground transition-transform duration-150 ease-geist hover:rotate-180" />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="px-3 py-1.5">
          <div className="group/search search-input-shell surface-input relative rounded-md">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50 transition-colors duration-150 ease-geist group-focus-within/search:text-muted-foreground" />
            <Input
              bare
              placeholder={t.searchConfig || "搜索配置"}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label={t.searchConfig || "搜索配置"}
              className="h-8 pl-8 text-label-14"
            />
          </div>
        </div>

        {configListContent}

        <AutomationBindingsSection
          repoId={selectedRepoScopeId}
          profiles={profiles}
          configPanelT={t}
          onGuideComposition={(profileId) => {
            const profile = profiles.find((entry) => entry.id === profileId);
            if (profile) {
              setCompositionPresetBackendId("github-actions");
              setCompositionProfile(profile);
            }
          }}
          onGuideReleaseSettings={(profileId) => {
            const profile = profiles.find((entry) => entry.id === profileId);
            if (profile) {
              setReleaseSettingsProfile(profile);
            }
          }}
          onCreateProfile={onCreateProfile}
        />
      </div>

      {compositionProfile ? (
        <CompositionEditorDialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setCompositionProfile(null);
              setCompositionPresetBackendId(null);
            }
          }}
          profile={compositionProfile}
          initialBackendId={compositionPresetBackendId}
          onSaveComposition={onSaveProfileComposition}
          onRebindProject={onRebindProfileProject}
        />
      ) : null}

      {releaseSettingsProfile && selectedRepoScopeId ? (
        <ReleaseSettingsEditorDialog
          key={releaseSettingsProfile.id}
          open
          onOpenChange={(open) => {
            if (!open) {
              setReleaseSettingsProfile(null);
            }
          }}
          repoId={selectedRepoScopeId}
          profile={releaseSettingsProfile}
          onSaved={onRefreshProfiles}
        />
      ) : null}

      <DeleteProfileConfirmDialog
        profile={pendingDeleteProfile}
        onClose={() => setPendingDeleteProfile(null)}
        onConfirm={(profile) => onDeleteProfile(profile.id)}
      />

      <ProjectProfileViewer
        ref={projectProfileViewerRef}
        projectFilePath={projectFilePath}
        projectFrameworkOptions={projectFrameworkOptions}
        dotnetSchema={dotnetSchema}
        configPanelT={t}
        commonT={commonT}
      />
    </div>
  );
});
