import {
  Fragment,
  startTransition,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { cn } from "@/lib/utils";
import { AppDialogInset } from "@/components/ui/app-dialog-inset";
import { AppDialogShell } from "@/components/ui/app-dialog-shell";
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
  MoreHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import {
  readProjectPublishProfile,
  type ConfigProfile,
  type PublishConfigStore,
} from "@/lib/store";
import {
  extractDotnetPublishParametersFromProjectProfile,
  parseProjectPublishProfileXml,
  type ParsedProjectPublishProfile,
} from "@/lib/projectPublishProfileXml";
import { createDotnetPublishConfigFromParameters } from "@/lib/dotnetPublishConfig";
import { extractInvokeErrorMessage } from "@/lib/tauri/invokeErrors";
import { useI18n } from "@/hooks/useI18n";
import type { PublishConfigFloatingBindings } from "@/components/layout/PublishConfigPanelFloatingLayer";
import { Dialog } from "@/components/ui/dialog";

const PublishConfigPanelFloatingLayer = lazy(async () => {
  const mod = await import("@/components/layout/PublishConfigPanelFloatingLayer");
  return { default: mod.PublishConfigPanelFloatingLayer };
});

const EMPTY_FLOATING_STYLE: CSSProperties = {};
const ALL_GROUP_FILTER = "__all__";
const PROJECT_GROUP_FILTER = "__project_profiles__";

type GroupFilterValue =
  | typeof ALL_GROUP_FILTER
  | typeof PROJECT_GROUP_FILTER
  | `profile-group:${string}`;

function createProfileGroupFilterValue(groupName: string): GroupFilterValue {
  return `profile-group:${groupName}`;
}

// Collapse toggle icon (reused from BranchPanel)
function CollapseIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <line x1="6" y1="2" x2="6" y2="14" stroke="currentColor" strokeWidth="1.5" />
      <path d="M11 6L8 8L11 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function normalizeRenderableConfigId(configId: string | null) {
  if (!configId) return null;
  return configId.startsWith("recent:") ? configId.slice("recent:".length) : configId;
}

export interface PublishConfigPanelProps {
  selectedPreset: string;
  isCustomMode: boolean;
  profiles: ConfigProfile[];
  activeProfileName: string | null;
  onSelectProfile: (profile: ConfigProfile) => void;
  onCreateProfile: () => void;
  onEditProfile: (profile: ConfigProfile) => void;
  onRefreshProfiles: () => void;
  onOpenConfigDialog: () => void;
  onDeleteProfile: (name: string) => void;
  projectPublishProfiles: string[];
  projectFilePath?: string;
  onSelectProjectProfile: (profileName: string) => void;
  onCopyProjectProfileToCustom: (
    sourceProfileName: string,
    config: PublishConfigStore
  ) => Promise<string>;
  recentConfigKeys: string[];
  favoriteConfigKeys: string[];
  onToggleFavoriteConfig: (configKey: string) => void;
  onRemoveRecentConfig: (configKey: string) => void;
  onCollapse?: () => void;
  showExpandButton?: boolean;
  onExpandRepo?: () => void;
}

type ProjectProfileViewerState =
  | {
      status: "idle";
      profileName: null;
    }
  | {
      status: "loading";
      profileName: string;
    }
  | {
      status: "ready";
      profileName: string;
      filePath: string;
      parsedProfile: ParsedProjectPublishProfile;
    }
  | {
      status: "error";
      profileName: string;
      errorMessage: string;
    };

// Collapsible group sub-component
function ConfigGroup({
  title,
  count,
  defaultExpanded = true,
  children,
  visible,
}: {
  title: string;
  count: number;
  defaultExpanded?: boolean;
  children: React.ReactNode;
  visible: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (!visible) return null;

  return (
    <div>
      <button
        className="flex w-full items-center gap-1.5 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground glass-transition"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        <span className="flex-1 text-left">{title}</span>
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums">
          {count}
        </span>
      </button>
      {expanded && <div className="space-y-1.5">{children}</div>}
    </div>
  );
}

type ConfigRowAction = {
  key: string;
  label: string;
  icon: JSX.Element;
  onSelect: () => void | Promise<unknown>;
  destructive?: boolean;
  separatorBefore?: boolean;
};

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
}): ConfigRowAction {
  return {
    key: "favorite",
    label: isFavorite ? unfavoriteLabel : favoriteLabel,
    icon: (
      <Star
        className={cn(
          "h-3.5 w-3.5",
          isFavorite
            ? "fill-green-500 text-green-500"
            : "text-muted-foreground/70"
        )}
      />
    ),
    onSelect,
  };
}

function ConfigRowActionsMenu({
  open,
  moreActionsLabel,
  itemLabel,
  actions,
  onOpenChange,
}: {
  open: boolean;
  moreActionsLabel: string;
  itemLabel: string;
  actions: ConfigRowAction[];
  onOpenChange: (open: boolean) => void;
}) {
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
          aria-label={`${moreActionsLabel}: ${itemLabel}`}
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.stopPropagation();
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
          }}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6}>
        {actions.map((action) => (
          <Fragment key={action.key}>
            {action.separatorBefore ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem
              className={cn(
                action.destructive && "text-destructive focus:bg-destructive/10"
              )}
              onSelect={() => {
                void action.onSelect();
              }}
            >
              {action.icon}
              <span>{action.label}</span>
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// User profile item with delete button on hover
function ProfileItem({
  profile,
  configKey,
  configId,
  isSelected,
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
}: {
  profile: ConfigProfile;
  configKey: string;
  configId: string;
  isSelected: boolean;
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
}) {
  const actions: ConfigRowAction[] = [
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
      icon: <Pencil className="h-3.5 w-3.5 text-muted-foreground/70" />,
      onSelect: onEdit,
    });
  }

  if (!profile.isSystemDefault) {
    actions.push({
      key: "delete",
      label: deleteTitle,
      icon: <Trash2 className="h-3.5 w-3.5" />,
      onSelect: onDelete,
      destructive: true,
      separatorBefore: canEdit,
    });
  }

  return (
    <div
      ref={rowRef}
      data-repo-row="true"
      data-repo-id={configId}
      data-menu-open={isMenuOpen ? "true" : "false"}
      className="group relative z-10"
      onMouseEnter={onItemMouseEnter}
      onFocusCapture={onItemMouseEnter}
    >
      <button
        type="button"
        aria-pressed={isSelected}
        className="flex w-full items-center gap-2.5 rounded-2xl border border-transparent bg-transparent px-3 py-2 pr-11 text-left shadow-none outline-none transition-all duration-300 hover:bg-[var(--glass-bg)]/20 focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
        onClick={onClick}
      >
        <span
          className={cn(
            "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[14px] transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
            isSelected
              ? "scale-105 bg-primary/10 shadow-[0_0_18px_hsl(var(--primary)/0.24)]"
              : "bg-[var(--glass-icon-bg)] shadow-[var(--glass-icon-highlight)] group-hover:scale-105 group-hover:bg-primary/8"
          )}
        >
          <FileText
            className={cn(
              "h-4 w-4 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
              isSelected
                ? "scale-110 text-primary drop-shadow-[0_0_4px_hsl(var(--primary)/0.3)]"
                : "text-muted-foreground/60 group-hover:text-primary group-hover:drop-shadow-[0_0_3px_hsl(var(--primary)/0.15)]"
            )}
          />
        </span>
        <div className="min-w-0 flex flex-1 items-center overflow-hidden">
          <span
            className={cn(
              "truncate text-[13px] font-medium tracking-tight transition-colors duration-300",
              isSelected ? "text-foreground" : "text-foreground/78"
            )}
          >
            {profile.name}
          </span>
        </div>
      </button>
      <div className="absolute inset-y-0 right-3 flex items-center">
        <ConfigRowActionsMenu
          open={isMenuOpen}
          moreActionsLabel={moreActionsLabel}
          itemLabel={profile.name}
          actions={actions}
          onOpenChange={onMenuOpenChange}
        />
      </div>
    </div>
  );
}

export function PublishConfigPanel({
  selectedPreset,
  isCustomMode,
  profiles,
  activeProfileName,
  onSelectProfile,
  onCreateProfile,
  onEditProfile,
  onRefreshProfiles,
  onOpenConfigDialog,
  onDeleteProfile,
  projectPublishProfiles,
  projectFilePath,
  onSelectProjectProfile,
  onCopyProjectProfileToCustom,
  recentConfigKeys,
  favoriteConfigKeys,
  onToggleFavoriteConfig,
  onRemoveRecentConfig,
  onCollapse,
  showExpandButton,
  onExpandRepo,
}: PublishConfigPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [groupFilterValue, setGroupFilterValue] =
    useState<GroupFilterValue>(ALL_GROUP_FILTER);
  const [groupFilterOpen, setGroupFilterOpen] = useState(false);
  const [openConfigMenuId, setOpenConfigMenuId] = useState<string | null>(null);
  const [preferredSelectedRenderId, setPreferredSelectedRenderId] = useState<string | null>(null);
  const [floatingEnhancerEnabled, setFloatingEnhancerEnabled] = useState(false);
  const [projectProfileViewerOpen, setProjectProfileViewerOpen] = useState(false);
  const [projectProfileViewerState, setProjectProfileViewerState] =
    useState<ProjectProfileViewerState>({
      status: "idle",
      profileName: null,
    });
  const { translations } = useI18n();
  const t = translations.configPanel || {};
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
  const headerButtonClass =
    "h-7 w-9 rounded-full p-0 text-muted-foreground/60 hover:bg-black/[0.045] hover:text-foreground hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.72),0_1px_2px_rgba(15,23,42,0.06)] dark:hover:bg-white/[0.06] dark:hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]";
  const fallbackListRef = useRef<HTMLDivElement | null>(null);
  const fallbackFloatingCardSurfaceRef = useRef<HTMLDivElement | null>(null);
  const latestProjectProfileRequestId = useRef(0);

  const query = searchQuery.toLowerCase();
  const favoriteSet = useMemo(
    () => new Set(favoriteConfigKeys),
    [favoriteConfigKeys]
  );

  // Build lookup maps for resolving recent keys
  const profileMap = useMemo(
    () => new Map(profiles.map((p) => [p.name, p])),
    [profiles]
  );
  const pubxmlSet = useMemo(
    () => new Set(projectPublishProfiles),
    [projectPublishProfiles]
  );

  // Resolve recent config keys to renderable items (max 6, skip stale entries)
  const recentItems = useMemo(() => {
    const items: Array<{
      key: string;
      name: string;
      description?: string;
      onClick: () => void;
    }> = [];

    for (const rk of recentConfigKeys) {
      if (items.length >= 6) break;
      const [type, ...rest] = rk.split(":");
      const id = rest.join(":");

      if (type === "pubxml") {
        if (!pubxmlSet.has(id)) continue;
        items.push({
          key: rk,
          name: id,
          onClick: () => onSelectProjectProfile(id),
        });
      } else if (type === "userprofile") {
        const profile = profileMap.get(id);
        if (!profile) continue;
        items.push({
          key: rk,
          name: profile.name,
          description: profile.providerId,
          onClick: () => onSelectProfile(profile),
        });
      }
    }
    return items;
  }, [
    recentConfigKeys,
    profileMap,
    pubxmlSet,
    isCustomMode,
    selectedPreset,
    activeProfileName,
    onSelectProjectProfile,
    onSelectProfile,
  ]);

  // Filter profiles
  const filteredProfiles = profiles.filter((p) => {
    if (!query) return true;
    return (
      p.name.toLowerCase().includes(query) ||
      p.providerId.toLowerCase().includes(query) ||
      (p.profileGroup || "").toLowerCase().includes(query)
    );
  });

  // Filter project publish profiles (.pubxml)
  const filteredProjectProfiles = projectPublishProfiles.filter((name) => {
    if (!query) return true;
    return name.toLowerCase().includes(query);
  });

  const groupFilterOptions = useMemo<
    Array<{ value: GroupFilterValue; label: string; count: number }>
  >(() => {
    const defaultGroupName = t.defaultProfileGroup || "默认分组";
    const groupMap = new Map<string, number>();

    for (const profile of profiles) {
      const groupName = profile.profileGroup?.trim() || defaultGroupName;
      groupMap.set(groupName, (groupMap.get(groupName) ?? 0) + 1);
    }

    const profileGroupOptions = Array.from(groupMap.entries())
      .map(([groupName, count]) => ({
        value: createProfileGroupFilterValue(groupName),
        label: groupName,
        count,
      }))
      .sort((left, right) => {
        if (left.label === defaultGroupName) return -1;
        if (right.label === defaultGroupName) return 1;
        return left.label.localeCompare(right.label);
      });

    const options: Array<{ value: GroupFilterValue; label: string; count: number }> = [
      {
        value: ALL_GROUP_FILTER,
        label: allConfigsLabel,
        count: projectPublishProfiles.length + profiles.length,
      },
    ];

    if (projectPublishProfiles.length > 0) {
      options.push({
        value: PROJECT_GROUP_FILTER,
        label: t.profileGroup || "项目发布配置",
        count: projectPublishProfiles.length,
      });
    }

    return [...options, ...profileGroupOptions];
  }, [
    profiles,
    projectPublishProfiles.length,
    allConfigsLabel,
    t.defaultProfileGroup,
    t.profileGroup,
  ]);

  const groupedFilteredProfiles = useMemo(() => {
    const defaultGroupName = t.defaultProfileGroup || "默认分组";
    const groupMap = new Map<string, ConfigProfile[]>();

    for (const profile of filteredProfiles) {
      const groupName = profile.profileGroup?.trim() || defaultGroupName;
      const group = groupMap.get(groupName);
      if (group) {
        group.push(profile);
      } else {
        groupMap.set(groupName, [profile]);
      }
    }

    return Array.from(groupMap.entries())
      .map(([groupName, items]) => ({ groupName, items }))
      .sort((left, right) => {
        if (left.groupName === defaultGroupName) return -1;
        if (right.groupName === defaultGroupName) return 1;
        return left.groupName.localeCompare(right.groupName);
      });
  }, [filteredProfiles, t.defaultProfileGroup]);

  useEffect(() => {
    if (groupFilterOptions.some((option) => option.value === groupFilterValue)) {
      return;
    }
    setGroupFilterValue(ALL_GROUP_FILTER);
  }, [groupFilterOptions, groupFilterValue]);

  const selectedGroupFilterOption = useMemo(
    () =>
      groupFilterOptions.find((option) => option.value === groupFilterValue) ??
      groupFilterOptions[0],
    [groupFilterOptions, groupFilterValue]
  );

  const visibleProjectProfiles = useMemo(() => {
    if (
      groupFilterValue !== ALL_GROUP_FILTER &&
      groupFilterValue !== PROJECT_GROUP_FILTER
    ) {
      return [];
    }
    return filteredProjectProfiles;
  }, [filteredProjectProfiles, groupFilterValue]);

  const visibleGroupedFilteredProfiles = useMemo(() => {
    if (groupFilterValue === ALL_GROUP_FILTER) {
      return groupedFilteredProfiles;
    }
    if (groupFilterValue === PROJECT_GROUP_FILTER) {
      return [];
    }
    return groupedFilteredProfiles.filter(
      (group) => createProfileGroupFilterValue(group.groupName) === groupFilterValue
    );
  }, [groupFilterValue, groupedFilteredProfiles]);

  const visibleConfigCount = useMemo(
    () =>
      visibleProjectProfiles.length +
      visibleGroupedFilteredProfiles.reduce(
        (total, group) => total + group.items.length,
        0
      ),
    [visibleGroupedFilteredProfiles, visibleProjectProfiles.length]
  );

  const showRecentItems =
    !query && groupFilterValue === ALL_GROUP_FILTER && recentItems.length > 0;
  const hasVisibleConfigResults =
    visibleProjectProfiles.length > 0 || visibleGroupedFilteredProfiles.length > 0;

  const selectedConfigId = useMemo(() => {
    if (isCustomMode && activeProfileName) {
      return `userprofile:${activeProfileName}`;
    }
    if (!isCustomMode && selectedPreset?.startsWith("profile-")) {
      const name = selectedPreset.slice("profile-".length);
      if (pubxmlSet.has(name)) return `pubxml:${name}`;
    }
    return null;
  }, [isCustomMode, activeProfileName, selectedPreset, pubxmlSet]);

  const allConfigIds = useMemo(() => {
    const ids: string[] = [];
    if (showRecentItems) {
      for (const item of recentItems) {
        ids.push(`recent:${item.key}`);
      }
    }
    for (const name of visibleProjectProfiles) {
      ids.push(`pubxml:${name}`);
    }
    for (const group of visibleGroupedFilteredProfiles) {
      for (const profile of group.items) {
        ids.push(`userprofile:${profile.name}`);
      }
    }
    return ids;
  }, [
    recentItems,
    showRecentItems,
    visibleGroupedFilteredProfiles,
    visibleProjectProfiles,
  ]);

  useEffect(() => {
    if (!openConfigMenuId) {
      return;
    }

    if (!allConfigIds.includes(openConfigMenuId)) {
      setOpenConfigMenuId(null);
    }
  }, [allConfigIds, openConfigMenuId]);

  const handleConfigMenuOpenChange = useCallback(
    (configId: string, open: boolean) => {
      setOpenConfigMenuId((current) => {
        if (open) {
          return configId;
        }

        return current === configId ? null : current;
      });
    },
    []
  );

  const selectedRenderId = useMemo(() => {
    if (!selectedConfigId) {
      return null;
    }

    if (
      preferredSelectedRenderId &&
      normalizeRenderableConfigId(preferredSelectedRenderId) === selectedConfigId &&
      allConfigIds.includes(preferredSelectedRenderId)
    ) {
      return preferredSelectedRenderId;
    }

    return selectedConfigId;
  }, [allConfigIds, preferredSelectedRenderId, selectedConfigId]);

  useEffect(() => {
    if (floatingEnhancerEnabled) {
      return;
    }

    const timerId = window.setTimeout(() => {
      startTransition(() => {
        setFloatingEnhancerEnabled(true);
      });
    }, 0);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [floatingEnhancerEnabled]);

  const createFallbackRowRef = useCallback(
    (_configId: string) => (_node: HTMLDivElement | null) => {},
    []
  );
  const noopPointerHandler = useCallback(
    (_event: ReactPointerEvent<HTMLDivElement>) => {},
    []
  );
  const noopHoverHandler = useCallback((_configId: string) => {}, []);
  const noopVoidHandler = useCallback(() => {}, []);

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

      try {
        const profileFile = await readProjectPublishProfile(
          projectFilePath,
          profileName
        );
        const parsedProfile = parseProjectPublishProfileXml(profileFile.content);

        if (latestProjectProfileRequestId.current !== requestId) {
          return;
        }

        setProjectProfileViewerState({
          status: "ready",
          profileName: profileFile.profileName,
          filePath: profileFile.filePath,
          parsedProfile,
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : extractInvokeErrorMessage(error);

        if (latestProjectProfileRequestId.current !== requestId) {
          return;
        }

        setProjectProfileViewerState({
          status: "error",
          profileName,
          errorMessage,
        });
        toast.error(t.loadConfigFailed || "加载配置失败", {
          description: errorMessage,
        });
      }
    },
    [projectFilePath, t.loadConfigFailed]
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
        const profileFile = await readProjectPublishProfile(
          projectFilePath,
          profileName
        );
        const parsedProfile = parseProjectPublishProfileXml(profileFile.content);
        const parameters =
          extractDotnetPublishParametersFromProjectProfile(parsedProfile);
        const config = createDotnetPublishConfigFromParameters(parameters);

        const createdProfileName = await onCopyProjectProfileToCustom(
          profileFile.profileName,
          config
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
      t.copyConfigFailed,
      t.copyConfigFailedDescription,
      t.copyConfigSuccess,
      t.copyConfigSuccessDescription,
    ]
  );

  const fallbackFloatingBindings = useMemo<PublishConfigFloatingBindings>(
    () => ({
      listRef: fallbackListRef as MutableRefObject<HTMLDivElement | null>,
      floatingCardSurfaceRef:
        fallbackFloatingCardSurfaceRef as MutableRefObject<HTMLDivElement | null>,
      cardTargetConfigId: null,
      floatingVisible: false,
      floatingCardMotionStyle: EMPTY_FLOATING_STYLE,
      floatingCardSurfaceStyle: EMPTY_FLOATING_STYLE,
      setConfigRowRef: createFallbackRowRef,
      handleConfigMouseEnter: noopHoverHandler,
      handleListPointerMove: noopPointerHandler,
      handleListPointerEnter: noopPointerHandler,
      handleListMouseLeave: noopVoidHandler,
      handleListScroll: noopVoidHandler,
    }),
    [
      createFallbackRowRef,
      noopHoverHandler,
      noopPointerHandler,
      noopVoidHandler,
    ]
  );

  const renderConfigList = useCallback(
    (floating: PublishConfigFloatingBindings) => (
      <div
        ref={floating.listRef}
        className="repo-list-scroll scrollbar-fade glass-scrollbar relative flex-1 overflow-auto px-2.5 py-2"
        onPointerEnter={floating.handleListPointerEnter}
        onPointerMove={floating.handleListPointerMove}
        onMouseLeave={floating.handleListMouseLeave}
        onScroll={floating.handleListScroll}
      >
        <div
          aria-hidden
          className={cn(
            "pointer-events-none !absolute z-0 origin-top-left transition-opacity duration-120 ease-linear",
            floating.floatingVisible ? "opacity-100" : "opacity-0"
          )}
          style={floating.floatingCardMotionStyle}
        >
          <div
            ref={floating.floatingCardSurfaceRef}
            data-selected={floating.cardTargetConfigId === selectedRenderId ? "true" : "false"}
            className="repo-floating-card h-full w-full transition-[box-shadow] duration-320 ease-[cubic-bezier(0.16,1,0.3,1)]"
            style={floating.floatingCardSurfaceStyle}
          />
        </div>
        <div className="glass-stagger">
          {showRecentItems && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                <span>{t.recentlyUsed || "最近使用"}</span>
              </div>
              {recentItems.map((item) => (
                <div
                  key={`recent-${item.key}`}
                  ref={floating.setConfigRowRef(`recent:${item.key}`)}
                  data-repo-row="true"
                  data-repo-id={`recent:${item.key}`}
                  data-menu-open={openConfigMenuId === `recent:${item.key}` ? "true" : "false"}
                  className="group relative z-10"
                  onMouseEnter={() => floating.handleConfigMouseEnter(`recent:${item.key}`)}
                  onFocusCapture={() => floating.handleConfigMouseEnter(`recent:${item.key}`)}
                >
                  <button
                    type="button"
                    aria-pressed={item.key === selectedConfigId}
                    className="flex w-full items-center gap-2.5 rounded-2xl border border-transparent bg-transparent px-3 py-2 pr-11 text-left shadow-none outline-none transition-all duration-300 hover:bg-[var(--glass-bg)]/20 focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                    onClick={() => {
                      setPreferredSelectedRenderId(`recent:${item.key}`);
                      item.onClick();
                    }}
                  >
                    <span
                      className={cn(
                        "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[14px] transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                        selectedRenderId === `recent:${item.key}`
                          ? "scale-105 bg-primary/10 shadow-[0_0_18px_hsl(var(--primary)/0.24)]"
                          : "bg-[var(--glass-icon-bg)] shadow-[var(--glass-icon-highlight)] group-hover:scale-105 group-hover:bg-primary/8"
                      )}
                    >
                      <FileText
                        className={cn(
                          "h-4 w-4 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                          selectedRenderId === `recent:${item.key}`
                            ? "scale-110 text-primary drop-shadow-[0_0_4px_hsl(var(--primary)/0.3)]"
                            : "text-muted-foreground/60 group-hover:text-primary group-hover:drop-shadow-[0_0_3px_hsl(var(--primary)/0.15)]"
                        )}
                      />
                    </span>
                    <div className="min-w-0 flex flex-1 items-center gap-2 overflow-hidden">
                      <span
                        className={cn(
                          "truncate text-[13px] font-medium tracking-tight transition-colors duration-300",
                          selectedRenderId === `recent:${item.key}`
                            ? "text-foreground"
                            : "text-foreground/78"
                        )}
                      >
                        {item.name}
                      </span>
                      {item.description ? (
                        <>
                          <span className="flex-shrink-0 text-muted-foreground/30">·</span>
                          <span className="truncate text-[11px] text-muted-foreground/55">
                            {item.description}
                          </span>
                        </>
                      ) : null}
                    </div>
                  </button>
                  <div className="absolute inset-y-0 right-3 flex items-center">
                    <ConfigRowActionsMenu
                      open={openConfigMenuId === `recent:${item.key}`}
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
                          icon: <X className="h-3.5 w-3.5" />,
                          onSelect: () => onRemoveRecentConfig(item.key),
                          destructive: true,
                          separatorBefore: true,
                        },
                      ]}
                      onOpenChange={(open) => {
                        handleConfigMenuOpenChange(`recent:${item.key}`, open);
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          <ConfigGroup
            title={t.profileGroup || "项目发布配置"}
            count={visibleProjectProfiles.length}
            defaultExpanded={true}
            visible={visibleProjectProfiles.length > 0}
          >
            {visibleProjectProfiles.map((name) => {
              const configKey = `pubxml:${name}`;
              const isPubxmlSelected = selectedRenderId === configKey;
              return (
                <div
                  key={`pubxml-${name}`}
                  ref={floating.setConfigRowRef(configKey)}
                  data-repo-row="true"
                  data-repo-id={configKey}
                  data-menu-open={openConfigMenuId === configKey ? "true" : "false"}
                  className="group relative z-10"
                  onMouseEnter={() => floating.handleConfigMouseEnter(configKey)}
                  onFocusCapture={() => floating.handleConfigMouseEnter(configKey)}
                >
                  <button
                    type="button"
                    aria-pressed={isPubxmlSelected}
                    className="flex w-full items-center gap-2.5 rounded-2xl border border-transparent bg-transparent px-3 py-2 pr-11 text-left shadow-none outline-none transition-all duration-300 hover:bg-[var(--glass-bg)]/20 focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                    onClick={() => {
                      setPreferredSelectedRenderId(configKey);
                      onSelectProjectProfile(name);
                    }}
                  >
                    <span
                      className={cn(
                        "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[14px] transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                        isPubxmlSelected
                          ? "scale-105 bg-primary/10 shadow-[0_0_18px_hsl(var(--primary)/0.24)]"
                          : "bg-[var(--glass-icon-bg)] shadow-[var(--glass-icon-highlight)] group-hover:scale-105 group-hover:bg-primary/8"
                      )}
                    >
                      <FileText
                        className={cn(
                          "h-4 w-4 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                          isPubxmlSelected
                            ? "scale-110 text-primary drop-shadow-[0_0_4px_hsl(var(--primary)/0.3)]"
                            : "text-muted-foreground/60 group-hover:text-primary group-hover:drop-shadow-[0_0_3px_hsl(var(--primary)/0.15)]"
                        )}
                      />
                    </span>
                    <div className="min-w-0 flex flex-1 items-center gap-2 overflow-hidden">
                      <span
                        className={cn(
                          "truncate text-[13px] font-medium tracking-tight transition-colors duration-300",
                          isPubxmlSelected ? "text-foreground" : "text-foreground/78"
                        )}
                      >
                        {name}
                      </span>
                    </div>
                  </button>
                  <div className="absolute inset-y-0 right-3 flex items-center">
                    <ConfigRowActionsMenu
                      open={openConfigMenuId === configKey}
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
                          label: t.copyConfig || "复制为自定义配置",
                          icon: <Copy className="h-3.5 w-3.5 text-muted-foreground/70" />,
                          onSelect: () => handleCopyProjectProfileToCustom(name),
                        },
                        {
                          key: "view",
                          label: t.viewConfig || "查看配置",
                          icon: <Eye className="h-3.5 w-3.5 text-muted-foreground/70" />,
                          onSelect: () => handleViewProjectProfile(name),
                        },
                      ]}
                      onOpenChange={(open) => {
                        handleConfigMenuOpenChange(configKey, open);
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </ConfigGroup>

          {visibleGroupedFilteredProfiles.map((group) => (
            <ConfigGroup
              key={`userprofile-group-${group.groupName}`}
              title={group.groupName}
              count={group.items.length}
              defaultExpanded={true}
              visible={true}
            >
              {group.items.map((profile) => (
                <ProfileItem
                  key={profile.name}
                  profile={profile}
                  configKey={`userprofile:${profile.name}`}
                  configId={`userprofile:${profile.name}`}
                  isSelected={
                    selectedRenderId === `userprofile:${profile.name}`
                  }
                  isFavorite={favoriteSet.has(`userprofile:${profile.name}`)}
                  isMenuOpen={openConfigMenuId === `userprofile:${profile.name}`}
                  onClick={() => {
                    setPreferredSelectedRenderId(`userprofile:${profile.name}`);
                    onSelectProfile(profile);
                  }}
                  onToggleFavorite={onToggleFavoriteConfig}
                  onEdit={() => onEditProfile(profile)}
                  canEdit={!profile.isSystemDefault && profile.providerId === "dotnet"}
                  editTitle={t.editConfig || "编辑配置"}
                  deleteTitle={deleteConfigLabel}
                  favoriteLabel={favoriteConfigLabel}
                  unfavoriteLabel={unfavoriteConfigLabel}
                  moreActionsLabel={moreActionsLabel}
                  onDelete={() => onDeleteProfile(profile.name)}
                  onMenuOpenChange={(open) => {
                    handleConfigMenuOpenChange(`userprofile:${profile.name}`, open);
                  }}
                  rowRef={floating.setConfigRowRef(`userprofile:${profile.name}`)}
                  onItemMouseEnter={() => floating.handleConfigMouseEnter(`userprofile:${profile.name}`)}
                />
              ))}
            </ConfigGroup>
          ))}
          {!showRecentItems && !hasVisibleConfigResults && (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">
              {t.noConfigs || "暂无配置"}
            </div>
          )}
        </div>
      </div>
    ),
    [
      deleteConfigLabel,
      favoriteSet,
      favoriteConfigLabel,
      hasVisibleConfigResults,
      onDeleteProfile,
      onEditProfile,
      onRemoveRecentConfig,
      onSelectProfile,
      onSelectProjectProfile,
      onToggleFavoriteConfig,
      openConfigMenuId,
      recentItems,
      removeRecentLabel,
      selectedConfigId,
      selectedRenderId,
      showRecentItems,
      t,
      moreActionsLabel,
      unfavoriteConfigLabel,
      handleConfigMenuOpenChange,
      handleCopyProjectProfileToCustom,
      handleViewProjectProfile,
      visibleGroupedFilteredProfiles,
      visibleProjectProfiles,
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
              className={headerButtonClass}
              onClick={(e) => {
                e.stopPropagation();
                onExpandRepo();
              }}
              title={t.expandRepoList || "展开仓库列表"}
              data-tauri-no-drag
            >
              <Folder className="h-4 w-4" />
            </Button>
          )}
          {onCollapse && (
            <Button
              variant="ghost"
              size="icon"
              className={headerButtonClass}
              onClick={(e) => {
                e.stopPropagation();
                onCollapse();
              }}
              title={t.collapsePanel || "收起面板"}
              data-tauri-no-drag
            >
              <CollapseIcon />
            </Button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between px-3 py-2">
        <DropdownMenu open={groupFilterOpen} onOpenChange={setGroupFilterOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="glass-surface flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium transition-all duration-300 hover:bg-[var(--glass-bg-hover)]"
              aria-haspopup="menu"
              aria-expanded={groupFilterOpen}
            >
              <span className="text-foreground/80">
                {selectedGroupFilterOption?.label || allConfigsLabel}
              </span>
              <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary/12 px-1 text-[10px] font-bold leading-none text-primary">
                {visibleConfigCount}
              </span>
              <ChevronDown
                className={cn(
                  "h-3 w-3 text-muted-foreground/60 transition-transform duration-300",
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
                groupFilterValue === ALL_GROUP_FILTER && "bg-[var(--glass-bg-hover)]"
              )}
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="truncate">{allConfigsLabel}</span>
                <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary/12 px-1 text-[10px] font-bold leading-none text-primary">
                  {groupFilterOptions[0]?.count ?? 0}
                </span>
              </div>
              {groupFilterValue === ALL_GROUP_FILTER ? (
                <Check className="h-3.5 w-3.5 text-primary" />
              ) : null}
            </DropdownMenuItem>
            {groupFilterOptions.length > 1 ? <DropdownMenuSeparator /> : null}
            {groupFilterOptions.slice(1).map((option) => (
              <DropdownMenuItem
                key={option.value}
                onSelect={() => setGroupFilterValue(option.value)}
                className={cn(
                  "justify-between gap-3",
                  groupFilterValue === option.value && "bg-[var(--glass-bg-hover)]"
                )}
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="truncate">{option.label}</span>
                  <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary/12 px-1 text-[10px] font-bold leading-none text-primary">
                    {option.count}
                  </span>
                </div>
                {groupFilterValue === option.value ? (
                  <Check className="h-3.5 w-3.5 text-primary" />
                ) : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="glass-surface flex h-7 w-7 items-center justify-center rounded-full transition-all duration-300 hover:bg-[var(--glass-bg-hover)]"
            onClick={(e) => {
              e.stopPropagation();
              onCreateProfile();
            }}
            title={t.newConfig || "新建配置"}
            data-tauri-no-drag
          >
            <Plus className="h-3.5 w-3.5 text-muted-foreground transition-transform duration-300 hover:rotate-90" />
          </button>
          <button
            type="button"
            className="glass-surface flex h-7 w-7 items-center justify-center rounded-full transition-all duration-300 hover:bg-[var(--glass-bg-hover)]"
            onClick={(e) => {
              e.stopPropagation();
              onRefreshProfiles();
            }}
            title={t.refresh || "刷新配置"}
            data-tauri-no-drag
          >
            <RefreshCw className="h-3.5 w-3.5 text-muted-foreground transition-all duration-300 hover:rotate-180" />
          </button>
          <button
            type="button"
            className="glass-surface flex h-7 w-7 items-center justify-center rounded-full transition-all duration-300 hover:bg-[var(--glass-bg-hover)]"
            onClick={(e) => {
              e.stopPropagation();
              onOpenConfigDialog();
            }}
            title={configManagementLabel}
            aria-label={configManagementLabel}
            data-tauri-no-drag
          >
            <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground transition-all duration-300 hover:rotate-180" />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 py-1.5">
        <div className="group/search glass-input relative rounded-xl">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50 transition-colors duration-300 group-focus-within/search:text-primary" />
          <Input
            placeholder={t.searchConfig || "搜索配置"}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 border-none bg-transparent pl-8 text-sm shadow-none focus-visible:ring-0"
          />
        </div>
      </div>

      {!floatingEnhancerEnabled ? (
        renderConfigList(fallbackFloatingBindings)
      ) : (
        <Suspense fallback={renderConfigList(fallbackFloatingBindings)}>
          <PublishConfigPanelFloatingLayer
            allConfigIds={allConfigIds}
            selectedRenderId={selectedRenderId}
          >
            {renderConfigList}
          </PublishConfigPanelFloatingLayer>
        </Suspense>
      )}

      <Dialog
        open={projectProfileViewerOpen}
        onOpenChange={setProjectProfileViewerOpen}
      >
        <AppDialogShell
          size="wide"
          title={t.viewConfigTitle || "查看发布配置"}
          description={
            projectProfileViewerState.profileName
              ? `${
                  t.viewConfigDescription || "查看项目发布配置文件中的全部参数。"
                } · ${projectProfileViewerState.profileName}`
              : t.viewConfigDescription ||
                "查看项目发布配置文件中的全部参数。"
          }
          icon={<Eye className="h-4 w-4" />}
          bodyInnerClassName="max-h-[70vh] space-y-4 pr-1"
          footer={
            <div className="flex w-full justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => setProjectProfileViewerOpen(false)}
              >
                {t.close || "关闭"}
              </Button>
            </div>
          }
        >
          <div className="space-y-4">
            {projectProfileViewerState.status === "loading" ? (
              <div className="flex min-h-40 items-center justify-center rounded-2xl border border-dashed border-border/70 bg-muted/20 text-sm text-muted-foreground">
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                {t.loadingConfig || "正在加载配置..."}
              </div>
            ) : null}

            {projectProfileViewerState.status === "error" ? (
              <AppDialogInset className="border-destructive/30 bg-destructive/5 text-sm text-destructive shadow-none">
                {projectProfileViewerState.errorMessage}
              </AppDialogInset>
            ) : null}

            {projectProfileViewerState.status === "ready" ? (
              <>
                <AppDialogInset>
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t.configFilePath || "配置文件路径"}
                  </div>
                  <div className="mt-2 break-all font-mono text-xs text-foreground/80">
                    {projectProfileViewerState.filePath}
                  </div>
                </AppDialogInset>

                <div className="space-y-3">
                  <div className="text-sm font-semibold text-foreground">
                    {t.parsedParameters || "解析参数"}
                  </div>
                  {projectProfileViewerState.parsedProfile.sections.map((section) => (
                    <AppDialogInset key={section.id} as="section">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-foreground">
                          {section.title}
                        </h3>
                        {Object.entries(section.attributes).map(([key, value]) => (
                          <span
                            key={`${section.id}-${key}`}
                            className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[11px] text-primary"
                          >
                            {key}={value}
                          </span>
                        ))}
                      </div>

                      {section.entries.length > 0 ? (
                        <div className="mt-3 space-y-2">
                          {section.entries.map((entry, entryIndex) => (
                            <div
                              key={`${section.id}-${entry.path}-${entryIndex}`}
                              className="rounded-xl border border-border/60 bg-background/70 p-3"
                            >
                              <div className="break-all text-sm font-medium text-foreground">
                                {entry.key}
                              </div>
                              <div className="mt-1 break-all font-mono text-xs text-muted-foreground">
                                {entry.value || "—"}
                              </div>
                              {Object.keys(entry.attributes).length > 0 ? (
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {Object.entries(entry.attributes).map(
                                    ([key, value]) => (
                                      <span
                                        key={`${entry.path}-${key}`}
                                        className="rounded-full bg-secondary px-2 py-0.5 font-mono text-[11px] text-secondary-foreground"
                                      >
                                        {key}={value}
                                      </span>
                                    )
                                  )}
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-3 text-xs text-muted-foreground">
                          {t.noConfigParameters || "配置文件中暂无可展示的参数"}
                        </div>
                      )}
                    </AppDialogInset>
                  ))}
                </div>

                <AppDialogInset className="p-0">
                  <details className="p-4">
                    <summary className="cursor-pointer text-sm font-semibold text-foreground">
                      {t.rawConfigFile || "原始配置文件"}
                    </summary>
                    <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-background/80 p-3 font-mono text-xs text-foreground/85">
                      {projectProfileViewerState.parsedProfile.rawXml}
                    </pre>
                  </details>
                </AppDialogInset>
              </>
            ) : null}
          </div>
        </AppDialogShell>
      </Dialog>
    </div>
  );
}
