import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Search,
  Plus,
  RefreshCw,
  Folder,
  ChevronRight,
  ChevronDown,
  Trash2,
  Clock,
  Star,
  X,
} from "lucide-react";
import type { ConfigProfile } from "@/lib/store";
import { useI18n } from "@/hooks/useI18n";

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

// Preset type matching App.tsx PRESETS structure
interface Preset {
  id: string;
  name: string;
  description: string;
  config: {
    configuration: string;
    runtime: string;
    self_contained: boolean;
  };
}

export interface PublishConfigPanelProps {
  presets: Preset[];
  selectedPreset: string;
  isCustomMode: boolean;
  onSelectPreset: (presetId: string) => void;
  profiles: ConfigProfile[];
  activeProfileName: string | null;
  onSelectProfile: (profile: ConfigProfile) => void;
  onCreateProfile: () => void;
  onRefreshProfiles: () => void;
  onDeleteProfile: (name: string) => void;
  projectPublishProfiles: string[];
  onSelectProjectProfile: (profileName: string) => void;
  recentConfigKeys: string[];
  favoriteConfigKeys: string[];
  onToggleFavoriteConfig: (configKey: string) => void;
  onRemoveRecentConfig: (configKey: string) => void;
  onCollapse?: () => void;
  showExpandButton?: boolean;
  onExpandRepo?: () => void;
  getPresetText: (
    presetId: string,
    fallbackName: string,
    fallbackDescription: string
  ) => { name: string; description: string };
}

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
      {expanded && <div>{children}</div>}
    </div>
  );
}

// Favorite toggle icon
function FavoriteButton({
  isFavorite,
  onToggle,
}: {
  isFavorite: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      title={isFavorite ? "取消收藏" : "收藏配置"}
    >
      <Star
        className={cn(
          "h-4 w-4 transition-colors",
          isFavorite
            ? "fill-green-500 text-green-500 animate-pulse"
            : "text-muted-foreground hover:text-foreground"
        )}
      />
    </button>
  );
}

// Preset config item
function ConfigItem({
  configKey,
  name,
  description,
  isSelected,
  isFavorite,
  onClick,
  onToggleFavorite,
}: {
  configKey: string;
  name: string;
  description: string;
  isSelected: boolean;
  isFavorite: boolean;
  onClick: () => void;
  onToggleFavorite: (configKey: string) => void;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 border-b border-[var(--glass-divider)] px-3 py-2.5 glass-transition hover:bg-[var(--glass-bg)] cursor-pointer",
        isSelected && "glass-surface-selected rounded-lg mx-1 border-0"
      )}
      onClick={onClick}
    >
      <FavoriteButton
        isFavorite={isFavorite}
        onToggle={() => onToggleFavorite(configKey)}
      />
      <div className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{name}</span>
        <span className="block truncate text-xs text-muted-foreground mt-0.5">
          {description}
        </span>
      </div>
    </div>
  );
}

// User profile item with delete button on hover
function ProfileItem({
  profile,
  configKey,
  isSelected,
  isFavorite,
  onClick,
  onToggleFavorite,
  onDelete,
}: {
  profile: ConfigProfile;
  configKey: string;
  isSelected: boolean;
  isFavorite: boolean;
  onClick: () => void;
  onToggleFavorite: (configKey: string) => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        "group flex items-start gap-2 border-b border-[var(--glass-divider)] px-3 py-2.5 glass-transition hover:bg-[var(--glass-bg)] cursor-pointer",
        isSelected && "glass-surface-selected rounded-lg mx-1 border-0"
      )}
      onClick={onClick}
    >
      <FavoriteButton
        isFavorite={isFavorite}
        onToggle={() => onToggleFavorite(configKey)}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{profile.name}</span>
          <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            {profile.providerId}
          </span>
        </div>
        <span className="block truncate text-xs text-muted-foreground mt-0.5">
          {new Date(profile.createdAt).toLocaleDateString()}
        </span>
      </div>
      {!profile.isSystemDefault && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 flex-shrink-0 opacity-0 group-hover:opacity-100 glass-transition"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 className="h-3.5 w-3.5 text-destructive" />
        </Button>
      )}
    </div>
  );
}

export function PublishConfigPanel({
  presets,
  selectedPreset,
  isCustomMode,
  onSelectPreset,
  profiles,
  activeProfileName,
  onSelectProfile,
  onCreateProfile,
  onRefreshProfiles,
  onDeleteProfile,
  projectPublishProfiles,
  onSelectProjectProfile,
  recentConfigKeys,
  favoriteConfigKeys,
  onToggleFavoriteConfig,
  onRemoveRecentConfig,
  onCollapse,
  showExpandButton,
  onExpandRepo,
  getPresetText,
}: PublishConfigPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const { translations } = useI18n();
  const t = translations.configPanel || {};

  const query = searchQuery.toLowerCase();
  const favoriteSet = useMemo(
    () => new Set(favoriteConfigKeys),
    [favoriteConfigKeys]
  );

  // Build lookup maps for resolving recent keys
  const presetMap = useMemo(
    () => new Map(presets.map((p) => [p.id, p])),
    [presets]
  );
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
      description: string;
      isSelected: boolean;
      onClick: () => void;
    }> = [];

    for (const rk of recentConfigKeys) {
      if (items.length >= 6) break;
      const [type, ...rest] = rk.split(":");
      const id = rest.join(":");

      if (type === "preset") {
        const preset = presetMap.get(id);
        if (!preset) continue;
        const text = getPresetText(preset.id, preset.name, preset.description);
        items.push({
          key: rk,
          name: text.name,
          description: text.description,
          isSelected: !isCustomMode && selectedPreset === id,
          onClick: () => onSelectPreset(id),
        });
      } else if (type === "pubxml") {
        if (!pubxmlSet.has(id)) continue;
        items.push({
          key: rk,
          name: id,
          description: ".pubxml",
          isSelected: !isCustomMode && selectedPreset === `profile-${id}`,
          onClick: () => onSelectProjectProfile(id),
        });
      } else if (type === "userprofile") {
        const profile = profileMap.get(id);
        if (!profile) continue;
        items.push({
          key: rk,
          name: profile.name,
          description: profile.providerId,
          isSelected: isCustomMode && activeProfileName === id,
          onClick: () => onSelectProfile(profile),
        });
      }
    }
    return items;
  }, [
    recentConfigKeys, presetMap, profileMap, pubxmlSet,
    isCustomMode, selectedPreset, activeProfileName, getPresetText,
    onSelectPreset, onSelectProjectProfile, onSelectProfile,
  ]);

  // Filter presets
  const releasePresets = presets.filter((p) => {
    if (!p.id.startsWith("release")) return false;
    if (!query) return true;
    const text = getPresetText(p.id, p.name, p.description);
    return (
      text.name.toLowerCase().includes(query) ||
      text.description.toLowerCase().includes(query)
    );
  });

  const debugPresets = presets.filter((p) => {
    if (!p.id.startsWith("debug")) return false;
    if (!query) return true;
    const text = getPresetText(p.id, p.name, p.description);
    return (
      text.name.toLowerCase().includes(query) ||
      text.description.toLowerCase().includes(query)
    );
  });

  // Filter profiles
  const filteredProfiles = profiles.filter((p) => {
    if (!query) return true;
    return (
      p.name.toLowerCase().includes(query) ||
      p.providerId.toLowerCase().includes(query)
    );
  });

  // Filter project publish profiles (.pubxml)
  const filteredProjectProfiles = projectPublishProfiles.filter((name) => {
    if (!query) return true;
    return name.toLowerCase().includes(query);
  });

  const projectProfileGroupCount = filteredProjectProfiles.length + filteredProfiles.length;

  return (
    <div className="flex h-full flex-col">
      {/* Header with action buttons */}
      <div
        data-tauri-drag-region
        className={cn(
          "flex h-10 items-center justify-end border-b border-[var(--glass-divider)] px-2",
          showExpandButton && "pl-[100px]"
        )}
      >
        <div className="flex items-center gap-0.5" data-tauri-no-drag>
          {showExpandButton && onExpandRepo && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
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
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={(e) => {
              e.stopPropagation();
              onCreateProfile();
            }}
            title={t.newConfig || "新建配置"}
            data-tauri-no-drag
          >
            <Plus className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={(e) => {
              e.stopPropagation();
              onRefreshProfiles();
            }}
            title={t.refresh || "刷新配置"}
            data-tauri-no-drag
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          {onCollapse && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
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

      {/* Search */}
      <div className="border-b border-[var(--glass-divider)] px-3 py-2">
        <div className="glass-input relative rounded-xl">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t.searchConfig || "搜索配置"}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 pl-8 text-sm"
          />
        </div>
      </div>

      {/* Config List */}
      <div className="flex-1 overflow-auto glass-scrollbar">
        <div className="glass-stagger">
          {/* Recently Used (non-collapsible, only when not searching) */}
          {!query && recentItems.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                <span>{t.recentlyUsed || "最近使用"}</span>
              </div>
              {recentItems.map((item) => (
                <div
                  key={`recent-${item.key}`}
                  className={cn(
                    "group flex items-start gap-2 border-b border-[var(--glass-divider)] px-3 py-2 glass-transition hover:bg-[var(--glass-bg)] cursor-pointer",
                    item.isSelected && "glass-surface-selected rounded-lg mx-1 border-0"
                  )}
                  onClick={item.onClick}
                >
                  <FavoriteButton
                    isFavorite={favoriteSet.has(item.key)}
                    onToggle={() => onToggleFavoriteConfig(item.key)}
                  />
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{item.name}</span>
                    <span className="block truncate text-xs text-muted-foreground mt-0.5">
                      {item.description}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 flex-shrink-0 opacity-0 group-hover:opacity-100 glass-transition"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveRecentConfig(item.key);
                    }}
                    title={t.removeRecent || "从最近使用移除"}
                  >
                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </div>
              ))}
              <div className="mx-3 border-b border-[var(--glass-divider)]" />
            </div>
          )}

          {/* Release group */}
          <ConfigGroup
            title={t.releaseGroup || "Release 配置"}
            count={releasePresets.length}
            defaultExpanded={true}
            visible={releasePresets.length > 0}
          >
            {releasePresets.map((preset) => {
              const text = getPresetText(preset.id, preset.name, preset.description);
              return (
                <ConfigItem
                  key={preset.id}
                  configKey={`preset:${preset.id}`}
                  name={text.name}
                  description={text.description}
                  isSelected={!isCustomMode && selectedPreset === preset.id}
                  isFavorite={favoriteSet.has(`preset:${preset.id}`)}
                  onClick={() => onSelectPreset(preset.id)}
                  onToggleFavorite={onToggleFavoriteConfig}
                />
              );
            })}
          </ConfigGroup>

          {/* Debug group */}
          <ConfigGroup
            title={t.debugGroup || "Debug 配置"}
            count={debugPresets.length}
            defaultExpanded={false}
            visible={debugPresets.length > 0}
          >
            {debugPresets.map((preset) => {
              const text = getPresetText(preset.id, preset.name, preset.description);
              return (
                <ConfigItem
                  key={preset.id}
                  configKey={`preset:${preset.id}`}
                  name={text.name}
                  description={text.description}
                  isSelected={!isCustomMode && selectedPreset === preset.id}
                  isFavorite={favoriteSet.has(`preset:${preset.id}`)}
                  onClick={() => onSelectPreset(preset.id)}
                  onToggleFavorite={onToggleFavoriteConfig}
                />
              );
            })}
          </ConfigGroup>

          {/* Project profiles group */}
          <ConfigGroup
            title={t.profileGroup || "项目发布配置"}
            count={projectProfileGroupCount}
            defaultExpanded={true}
            visible={true}
          >
            {/* .pubxml project publish profiles */}
            {filteredProjectProfiles.map((name) => {
              const configKey = `pubxml:${name}`;
              return (
                <div
                  key={`pubxml-${name}`}
                  className={cn(
                    "flex items-start gap-2 border-b border-[var(--glass-divider)] px-3 py-2.5 glass-transition hover:bg-[var(--glass-bg)] cursor-pointer",
                    !isCustomMode && selectedPreset === `profile-${name}` && "glass-surface-selected rounded-lg mx-1 border-0"
                  )}
                  onClick={() => onSelectProjectProfile(name)}
                >
                  <FavoriteButton
                    isFavorite={favoriteSet.has(configKey)}
                    onToggle={() => onToggleFavoriteConfig(configKey)}
                  />
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{name}</span>
                    <span className="block truncate text-xs text-muted-foreground mt-0.5">.pubxml</span>
                  </div>
                </div>
              );
            })}
            {/* User-saved ConfigProfile items */}
            {filteredProfiles.map((profile) => (
              <ProfileItem
                key={profile.name}
                profile={profile}
                configKey={`userprofile:${profile.name}`}
                isSelected={
                  isCustomMode && activeProfileName === profile.name
                }
                isFavorite={favoriteSet.has(`userprofile:${profile.name}`)}
                onClick={() => onSelectProfile(profile)}
                onToggleFavorite={onToggleFavoriteConfig}
                onDelete={() => onDeleteProfile(profile.name)}
              />
            ))}
            {projectProfileGroupCount === 0 && (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                {t.noProfiles || "暂无自定义配置"}
              </div>
            )}
          </ConfigGroup>
        </div>
      </div>
    </div>
  );
}
