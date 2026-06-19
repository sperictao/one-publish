import {
  Children,
  useCallback,
  useRef,
  useState,
  useMemo,
  memo,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { cn } from "@/lib/utils";
import {
  reorderItemsByDrop,
  reorderProfilesByDrop,
} from "@/lib/listOrdering";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Search,
  Plus,
  RefreshCw,
  Loader2,
  SlidersHorizontal,
  Folder,
  FileText,
  Eye,
  Copy,
  Check,
  ChevronRight,
  ChevronDown,
  Trash2,
  Pencil,
  Clock,
  Star,
  X,
  ArrowUpDown,
} from "lucide-react";
import { toast } from "sonner";
import {
  type ConfigProfile,
  type PublishConfigStore,
} from "@/lib/store/types";
import {
  ProjectPublishProfileViewerDialog,
  type ProjectProfileViewerState,
} from "@/components/publish/ProjectPublishProfileViewerDialog";
import { resolveDotnetProjectProfile } from "@/lib/dotnetProjectProfile";
import { extractInvokeErrorMessage } from "@/lib/tauri/invokeErrors";
import {
  createProjectProfileConfigKey,
  createRecentConfigRenderId,
  createUserProfileConfigKey,
  getProjectProfileNameFromRenderId,
  getRecentConfigKeyFromRenderId,
  getUserProfileNameFromRenderId,
} from "@/features/config/publishConfigIdentity";
import { useI18n } from "@/hooks/useI18n";
import {
  RowActionsMenu,
  type RowActionsMenuAction,
} from "@/components/layout/RowActionsMenu";
import {
  ListDragHandle,
} from "@/components/layout/ListReorderControls";
import { topbarIconButtonClass } from "@/components/layout/topbarButtonStyles";
import {
  usePointerListReorder,
} from "@/components/layout/usePointerListReorder";
import { useListInteractionState } from "@/components/layout/useListInteractionState";
import { composeNodeRefs } from "@/components/layout/composeNodeRefs";
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

const EMPTY_FRAMEWORK_OPTIONS: string[] = [];

// Collapse toggle icon (reused from BranchPanel)
function CollapseIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        x="1.5"
        y="1.5"
        width="13"
        height="13"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="1"
        fill="none"
      />
      <line
        x1="5.5"
        y1="1.5"
        x2="5.5"
        y2="14.5"
        stroke="currentColor"
        strokeWidth="1"
      />
      <path
        className="transition-transform duration-150 ease-geist group-hover:-translate-x-0.5"
        d="M11.5 5.5L9 8L11.5 10.5"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function hasSameStringOrder(
  left: readonly string[],
  right: readonly string[]
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function hasSameProfileOrder(
  left: readonly ConfigProfile[],
  right: readonly ConfigProfile[]
): boolean {
  return (
    left.length === right.length &&
    left.every((profile, index) => {
      const nextProfile = right[index];
      return (
        profile.name === nextProfile.name &&
        (profile.profileGroup || "") === (nextProfile.profileGroup || "")
      );
    })
  );
}

export interface PublishConfigPanelProps {
  selectedRepoId?: string | null;
  selectedPreset: string;
  isCustomMode: boolean;
  profiles: ConfigProfile[];
  isProfilesRefreshing?: boolean;
  activeProfileName: string | null;
  onSelectProfile: (profile: ConfigProfile) => void;
  onCreateProfile: () => void;
  onEditProfile: (profile: ConfigProfile) => void;
  onRefreshProfiles: () => void;
  onOpenConfigDialog: () => void;
  onDeleteProfile: (name: string) => void;
  dotnetSchema?: ParameterSchema;
  projectPublishProfiles: string[];
  isProjectProfilesRefreshing?: boolean;
  projectFilePath?: string;
  projectFrameworkOptions?: string[];
  onSelectProjectProfile: (profileName: string) => void;
  onCopyProjectProfileToCustom: (
    sourceProfileName: string,
    config: PublishConfigStore
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

function ConfigGroup({
  title,
  count,
  defaultExpanded = true,
  children,
  visible,
  isRefreshing = false,
  emptyState,
}: {
  title: string;
  count: number;
  defaultExpanded?: boolean;
  children: React.ReactNode;
  visible: boolean;
  isRefreshing?: boolean;
  emptyState?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const hasChildren = Children.count(children) > 0;

  if (!visible) return null;

  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors duration-150 ease-geist"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="size-3.5" />
        ) : (
          <ChevronRight className="size-3.5" />
        )}
        <span className="flex-1 text-left">{title}</span>
        {isRefreshing ? (
          <span className="inline-block animate-spin text-interactive/80">
            <Loader2 className="size-3.5" />
          </span>
        ) : null}
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
          {count}
        </span>
      </button>
      {expanded ? (
        hasChildren ? (
          <div className="space-y-1.5">{children}</div>
        ) : emptyState ? (
          <div className="px-3 py-4 text-xs text-muted-foreground">
            {emptyState}
          </div>
        ) : null
      ) : null}
    </div>
  );
}

function createFavoriteConfigAction({
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
          isFavorite
            ? "fill-success text-success"
            : "text-muted-foreground"
        )}
      />
    ),
    onSelect,
  };
}

// User profile item with delete button on hover
function ProfileItem({
  profile,
  configKey,
  configId,
  isSelected,
  isVisualTarget,
  isFavorite,
  isMenuOpen,
  onClick,
  onToggleFavorite,
  onEdit,
  canEdit,
  editTitle,
  deleteTitle,
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
}: {
  profile: ConfigProfile;
  configKey: string;
  configId: string;
  isSelected: boolean;
  isVisualTarget: boolean;
  isFavorite: boolean;
  isMenuOpen: boolean;
  onClick: () => void;
  onToggleFavorite: (configKey: string) => void;
  onEdit: () => void;
  canEdit: boolean;
  editTitle: string;
  deleteTitle: string;
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
    profileName: string,
    event: ReactPointerEvent<HTMLButtonElement>
  ) => void;
}) {
  const actions: RowActionsMenuAction[] = [
    createFavoriteConfigAction({
      isFavorite,
      favoriteLabel,
      unfavoriteLabel,
      onSelect: () => onToggleFavorite(configKey),
    }),
  ];

  if (canEdit) {
    actions.push({
      key: "edit",
      label: editTitle,
      icon: <Pencil className="size-3.5 text-muted-foreground/70" />,
      onSelect: onEdit,
    });
  }

  if (!profile.isSystemDefault) {
    actions.push({
      key: "delete",
      label: deleteTitle,
      icon: <Trash2 className="size-3.5" />,
      onSelect: onDelete,
      destructive: true,
      separatorBefore: canEdit,
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
          onHandlePointerDown(profile.name, event);
        }}
      />
      <button
        type="button"
        aria-pressed={isSelected}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg border border-transparent bg-transparent py-2 pr-11 text-left shadow-none outline-none transition-colors duration-150 ease-geist hover:bg-accent focus-visible:ring-2 focus-visible:ring-interactive/30 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
          isSelected && "bg-accent",
          dragHandleVisible ? "pl-10" : "pl-3"
        )}
        onClick={onClick}
      >
        <span
          className={cn(
            "flex size-8 flex-shrink-0 items-center justify-center rounded-md transition-colors duration-150 ease-geist",
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
        <div className="min-w-0 flex flex-1 items-center overflow-hidden">
          <span
            className={cn(
              "truncate text-[13px] font-semibold tracking-tight transition-colors duration-150 ease-geist",
              isSelected ? "text-foreground" : "text-foreground/78"
            )}
          >
            {profile.name}
          </span>
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

export const PublishConfigPanel = memo(function PublishConfigPanel({
  selectedRepoId,
  selectedPreset,
  isCustomMode,
  profiles,
  isProfilesRefreshing = false,
  activeProfileName,
  onSelectProfile,
  onCreateProfile,
  onEditProfile,
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
  const [projectProfileViewerOpen, setProjectProfileViewerOpen] = useState(false);
  const [projectProfileViewerState, setProjectProfileViewerState] =
    useState<ProjectProfileViewerState>({
      status: "idle",
      profileName: null,
    });
  const { translations } = useI18n();
  const t = translations.configPanel || {};
  const appT = translations.app || {};
  const profileT = translations.profiles || {};
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
  const recentlyUsedLabel = t.recentlyUsed || "最近使用";
  const dragToReorderLabel = t.dragToReorder || "拖动排序";
  const dragDisabledWhileSearchingLabel =
    t.dragDisabledWhileSearching || "搜索时无法排序";
  const profileGroupLabel = t.profileGroup || "项目发布配置";
  const copyConfigLabel = t.copyConfig || "复制为自定义配置";
  const viewConfigLabel = t.viewConfig || "查看配置";
  const editConfigLabel = t.editConfig || "编辑配置";
  const noConfigsLabel = t.noConfigs || "暂无配置";
  const projectProfilesRefreshingLabel =
    t.refreshingProjectProfiles || "正在刷新项目发布配置...";
  const customProfilesRefreshingLabel =
    t.refreshingCustomProfiles || "正在刷新自定义配置...";
  const isAnyRefreshing = isProfilesRefreshing || isProjectProfilesRefreshing;
  const listActionButtonClass =
    "flex size-7 items-center justify-center rounded-full border border-border bg-background transition-colors duration-150 ease-geist hover:bg-accent";
  const reorderControlsLabel = showReorderControls
    ? t.hideReorderControls || "关闭排序"
    : t.showReorderControls || "开启排序";
  const latestProjectProfileRequestId = useRef(0);

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
    selectedPreset,
    isCustomMode,
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
      settleConfigFromDragEnd(
        result,
        (itemId) => createRecentConfigRenderId(itemId)
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
      settleConfigFromDragEnd(
        result,
        (itemId) => createProjectProfileConfigKey(itemId)
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
      settleConfigFromDragEnd(
        result,
        (itemId) => createUserProfileConfigKey(itemId)
      );
    },
    onCommit: (activeProfileName, target) => {
      const nextProfiles = reorderProfilesByDrop({
        profiles,
        activeProfileName,
        targetProfileName: target.itemId,
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
            activeProfileName: customProfileReorder.draggingItemId,
            targetProfileName: customProfileReorder.dropTarget.itemId,
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
    orderedIds: previewProfiles.map((profile) => profile.name),
    draggingItemId: customProfileReorder.draggingItemId,
    settledItemId: getUserProfileNameFromRenderId(settledConfigRenderId),
    resetKey: selectedRepoScopeId,
  });
  const draggingConfigRenderId = useMemo(() => {
    if (recentReorder.draggingItemId) {
      return createRecentConfigRenderId(recentReorder.draggingItemId);
    }

    if (projectProfileReorder.draggingItemId) {
      return createProjectProfileConfigKey(projectProfileReorder.draggingItemId);
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

  const handleViewProjectProfile = useCallback(
    async (profileName: string) => {
      setProjectProfileViewerOpen(true);

      if (!projectFilePath) {
        const errorMessage = "当前项目文件路径不可用，无法读取发布配置。";
        setProjectProfileViewerState({
          status: "error",
          profileName,
          errorMessage,
        });
        toast.error(t.loadConfigFailed || "加载配置失败", {
          description: errorMessage,
        });
        return;
      }

      const requestId = latestProjectProfileRequestId.current + 1;
      latestProjectProfileRequestId.current = requestId;
      setProjectProfileViewerState({
        status: "loading",
        profileName,
      });

      resolveDotnetProjectProfile({
        projectInfo: {
          root_path: "",
          project_file: projectFilePath,
          target_frameworks: projectFrameworkOptions,
        },
        profileName,
      })
        .then((resolvedProfile) => {
          if (latestProjectProfileRequestId.current !== requestId) {
            return;
          }

          setProjectProfileViewerState({
            status: "ready",
            profileName: resolvedProfile.profileName,
            filePath: resolvedProfile.filePath,
            editableConfig: resolvedProfile.editableConfig,
            parsedProfile: resolvedProfile.parsedProfile,
          });
        })
        .catch((error) => {
          if (latestProjectProfileRequestId.current !== requestId) {
            return;
          }

          const errorMessage =
            error instanceof Error
              ? error.message
              : extractInvokeErrorMessage(error);

          setProjectProfileViewerState({
            status: "error",
            profileName,
            errorMessage,
          });
          toast.error(t.loadConfigFailed || "加载配置失败", {
            description: errorMessage,
          });
        });
    },
    [projectFilePath, projectFrameworkOptions, t.loadConfigFailed]
  );

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
          resolvedProfile.editableConfig
        );
        toast.success(t.copyConfigSuccess || "已复制为自定义配置", {
          description:
            (t.copyConfigSuccessDescription ||
              "已根据项目发布配置生成可编辑的自定义配置：{{name}}").replace(
              "{{name}}",
              createdProfileName
            ),
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : extractInvokeErrorMessage(error);
        toast.error(t.copyConfigFailed || "复制为自定义配置失败", {
          description: errorMessage,
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
    ]
  );

  const handleProjectProfileViewerOpenChange = useCallback((open: boolean) => {
    setProjectProfileViewerOpen(open);
  }, []);

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

  const configListContent = useMemo(
    () => {
      return (
        <div
          className="list-scroll-shell scrollbar-fade geist-scrollbar relative flex-1 overflow-auto px-2.5 py-2"
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
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Clock className="size-3.5" />
                  <span>{recentlyUsedLabel}</span>
                </div>
                {previewRecentItems.map((item) => {
                  const renderId = createRecentConfigRenderId(item.key);
                  return (
                <div
                  key={`recent-${item.key}`}
                  ref={composeNodeRefs(
                    recentReorder.setItemRef(item.key, undefined),
                    recentMotion.setItemRef(item.key)
                  )}
                  data-list-row="true"
                  data-list-item-id={renderId}
                  data-list-visual-target={
                    visualTargetConfigId === renderId
                      ? "true"
                      : "false"
                  }
                  data-list-menu-open={
                    interaction.isMenuOpenForItem(renderId)
                      ? "true"
                      : "false"
                  }
                  className={cn(
                    "group relative z-10",
                    recentReorder.draggingItemId === item.key &&
                      "pointer-events-none z-40"
                  )}
                  style={
                    recentReorder.draggingItemId === item.key
                      ? recentReorder.dragPreviewStyle
                      : undefined
                  }
                  onMouseEnter={() =>
                    interaction.handleRowMouseEnter(renderId)
                  }
                  onFocusCapture={() =>
                    interaction.handleRowFocus(renderId)
                  }
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
                    visible={recentDragEnabled}
                    enabled={recentDragEnabled}
                    label={dragToReorderLabel}
                    disabledLabel={dragDisabledWhileSearchingLabel}
                    onPointerDown={(event) => {
                      recentReorder.startDrag(item.key, event);
                    }}
                  />
                  <button
                    type="button"
                    aria-pressed={item.key === selectedConfigId}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg border border-transparent bg-transparent py-2 pr-11 text-left shadow-none outline-none transition-colors duration-150 ease-geist hover:bg-accent focus-visible:ring-2 focus-visible:ring-interactive/30 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                      selectedRenderId === renderId && "bg-accent",
                      recentDragEnabled ? "pl-10" : "pl-3"
                    )}
                    onClick={() => {
                      setPreferredSelectedRenderAnchor({
                        repoId: selectedRepoScopeId,
                        renderId,
                      });
                      handleSelectRecentItem(item);
                    }}
                  >
                    <span
                      className={cn(
                        "flex size-8 flex-shrink-0 items-center justify-center rounded-md transition-colors duration-150 ease-geist",
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
                          "truncate text-[13px] font-semibold tracking-tight transition-colors duration-150 ease-geist",
                          selectedRenderId === renderId
                            ? "text-foreground"
                            : "text-foreground/78"
                        )}
                      >
                        {item.name}
                      </span>
                      {item.description ? (
                        <>
                          <span className="flex-shrink-0 text-muted-foreground/30">·</span>
                          <span className="truncate text-[11px] text-muted-foreground">
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
                          favoriteLabel: favoriteConfigLabel,
                          unfavoriteLabel: unfavoriteConfigLabel,
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
            )}

          <ConfigGroup
            title={profileGroupLabel}
            count={previewVisibleProjectProfiles.length}
            defaultExpanded={true}
            visible={
              previewVisibleProjectProfiles.length > 0 ||
              shouldShowProjectProfilesLoadingState
            }
            isRefreshing={isProjectProfilesRefreshing}
            emptyState={
              shouldShowProjectProfilesLoadingState ? (
                <span className="flex items-center gap-2">
                  <span className="inline-block animate-spin text-interactive/80">
                    <Loader2 className="size-3.5" />
                  </span>
                  {projectProfilesRefreshingLabel}
                </span>
              ) : null
            }
          >
            {previewVisibleProjectProfiles.map((name) => {
              const configKey = createProjectProfileConfigKey(name);
              const isPubxmlSelected = selectedRenderId === configKey;
              return (
                <div
                  key={`pubxml-${name}`}
                  ref={composeNodeRefs(
                    projectProfileReorder.setItemRef(name, undefined),
                    projectMotion.setItemRef(name)
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
                    projectProfileReorder.draggingItemId === name &&
                      "pointer-events-none z-40"
                  )}
                  style={
                    projectProfileReorder.draggingItemId === name
                      ? projectProfileReorder.dragPreviewStyle
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
                    visible={projectProfileDragEnabled}
                    enabled={projectProfileDragEnabled}
                    label={dragToReorderLabel}
                    disabledLabel={dragDisabledWhileSearchingLabel}
                    onPointerDown={(event) => {
                      projectProfileReorder.startDrag(name, event);
                    }}
                  />
                  <button
                    type="button"
                    data-testid={`pubxml-select-${name}`}
                    data-selected={isPubxmlSelected}
                    aria-pressed={isPubxmlSelected}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg border border-transparent bg-transparent py-2 pr-11 text-left shadow-none outline-none transition-colors duration-150 ease-geist hover:bg-accent focus-visible:ring-2 focus-visible:ring-interactive/30 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                      projectProfileDragEnabled ? "pl-10" : "pl-3"
                    )}
                    onClick={() => {
                      setPreferredSelectedRenderAnchor({
                        repoId: selectedRepoScopeId,
                        renderId: configKey,
                      });
                      onSelectProjectProfile(name);
                    }}
                  >
                    <span
                      className={cn(
                        "flex size-8 flex-shrink-0 items-center justify-center rounded-md transition-colors duration-150 ease-geist",
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
                          "truncate text-[13px] font-semibold tracking-tight transition-colors duration-150 ease-geist",
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
                          favoriteLabel: favoriteConfigLabel,
                          unfavoriteLabel: unfavoriteConfigLabel,
                          onSelect: () => onToggleFavoriteConfig(configKey),
                        }),
                        {
                          key: "copy",
                          label: copyConfigLabel,
                          icon: <Copy className="size-3.5 text-muted-foreground/70" />,
                          onSelect: () => handleCopyProjectProfileToCustom(name),
                        },
                        {
                          key: "view",
                          label: viewConfigLabel,
                          icon: <Eye className="size-3.5 text-muted-foreground/70" />,
                          onSelect: () => handleViewProjectProfile(name),
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

          {previewVisibleGroupedFilteredProfiles.map((group) => (
            <ConfigGroup
              key={`userprofile-group-${group.groupName}`}
              title={group.groupName}
              count={group.items.length}
              defaultExpanded={true}
              visible={true}
            >
              {group.items.map((profile) => {
                const configKey = createUserProfileConfigKey(profile.name);
                return (
                <ProfileItem
                  key={profile.name}
                  profile={profile}
                  configKey={configKey}
                  configId={configKey}
                  isSelected={selectedRenderId === configKey}
                  isVisualTarget={visualTargetConfigId === configKey}
                  isFavorite={favoriteSet.has(configKey)}
                  isMenuOpen={interaction.isMenuOpenForItem(configKey)}
                  onClick={() => {
                    setPreferredSelectedRenderAnchor({
                      repoId: selectedRepoScopeId,
                      renderId: configKey,
                    });
                    onSelectProfile(profile);
                  }}
                  onToggleFavorite={onToggleFavoriteConfig}
                  onEdit={() => onEditProfile(profile)}
                  canEdit={!profile.isSystemDefault && profile.providerId === "dotnet"}
                  editTitle={editConfigLabel}
                  deleteTitle={deleteConfigLabel}
                  favoriteLabel={favoriteConfigLabel}
                  unfavoriteLabel={unfavoriteConfigLabel}
                  moreActionsLabel={moreActionsLabel}
                  onDelete={() => onDeleteProfile(profile.name)}
                  onMenuOpenChange={(open) => {
                    interaction.handleMenuOpenChange(configKey, open);
                  }}
                  rowRef={composeNodeRefs(
                    customProfileReorder.setItemRef(profile.name, {
                      groupKey: group.groupKey,
                    }),
                    customMotion.setItemRef(profile.name)
                  )}
                  onItemMouseEnter={() =>
                    interaction.handleRowMouseEnter(configKey)
                  }
                  onItemFocus={() =>
                    interaction.handleRowFocus(configKey)
                  }
                  onItemBlur={() =>
                    interaction.handleRowBlur(configKey)
                  }
                  groupKey={group.groupKey}
                  dragEnabled={customProfileDragEnabled}
                  dragHandleVisible={customProfileDragEnabled}
                  dragHandleLabel={dragToReorderLabel}
                  dragDisabledLabel={dragDisabledWhileSearchingLabel}
                  isDragging={customProfileReorder.draggingItemId === profile.name}
                  dragPreviewStyle={customProfileReorder.dragPreviewStyle}
                  onHandlePointerDown={customProfileReorder.startDrag}
                />
                );
              })}
            </ConfigGroup>
          ))}
          {shouldShowCustomProfilesLoadingState ? (
            <div className="flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground">
              <span className="inline-block animate-spin text-interactive/80">
                <Loader2 className="size-3.5" />
              </span>
              <span>{customProfilesRefreshingLabel}</span>
            </div>
          ) : null}
          {shouldShowEmptyState && (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">
              {noConfigsLabel}
            </div>
          )}
          </div>
        </div>
      );
    },
    [
      deleteConfigLabel,
      favoriteSet,
      favoriteConfigLabel,
      handleConfigListPointerLeave,
      handleConfigListPointerReentry,
      handleSelectRecentItem,
      customProfileDragEnabled,
      customProfilesRefreshingLabel,
      customMotion,
      onDeleteProfile,
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
      handleViewProjectProfile,
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
      noConfigsLabel,
      profileGroupLabel,
      recentlyUsedLabel,
      visualTargetConfigId,
      viewConfigLabel,
    ]
  );

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
          <DropdownMenu open={groupFilterOpen} onOpenChange={setGroupFilterOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-sm font-normal transition-colors duration-150 ease-geist hover:bg-accent"
                aria-haspopup="menu"
                aria-expanded={groupFilterOpen}
              >
                <span className="text-foreground/80">
                  {selectedGroupFilterOption?.label || allConfigsLabel}
                </span>
                <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-interactive/10 px-1 text-[10px] font-bold leading-none text-interactive">
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
            <DropdownMenuContent align="start" sideOffset={8} className="min-w-[13rem]">
              <DropdownMenuItem
                onSelect={() => setGroupFilterValue(ALL_GROUP_FILTER)}
                className={cn(
                  "justify-between gap-3",
                  groupFilterValue === ALL_GROUP_FILTER && "bg-accent"
                )}
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="truncate">{allConfigsLabel}</span>
                  <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-interactive/10 px-1 text-[10px] font-bold leading-none text-interactive">
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
                    <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-interactive/10 px-1 text-[10px] font-bold leading-none text-interactive">
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
          <div className="group/search surface-input relative rounded-md">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50 transition-colors duration-150 ease-geist group-focus-within/search:text-interactive" />
            <Input
              placeholder={t.searchConfig || "搜索配置"}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label={t.searchConfig || "搜索配置"}
              className="h-8 border-none bg-transparent pl-8 text-sm shadow-none focus-visible:ring-0"
            />
          </div>
        </div>

        {configListContent}
      </div>

      <ProjectPublishProfileViewerDialog
        open={projectProfileViewerOpen}
        onOpenChange={handleProjectProfileViewerOpenChange}
        viewerState={projectProfileViewerState}
        dotnetSchema={dotnetSchema}
        projectFrameworkOptions={projectFrameworkOptions}
        profileT={profileT}
        appT={appT}
        commonT={commonT}
        configPanelT={t}
      />
    </div>
  );
});
