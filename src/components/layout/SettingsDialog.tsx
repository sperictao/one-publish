import {
  Dialog,
} from "@/components/ui/dialog";
import { AppDialogShell } from "@/components/ui/app-dialog-shell";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Languages,
  Minimize2,
  Palette,
  FolderOpen,
  RefreshCw,
  Download,
  Info,
  ListChecks,
  Keyboard,
  type LucideIcon,
} from "lucide-react";
import {
  Suspense,
  lazy,
  memo,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ProviderManifest } from "@/lib/store";
import { isTauri } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import type { AppUpdaterState } from "@/hooks/useAppUpdater";
import { useI18n, t } from "@/hooks/useI18n";
import type { Language } from "@/hooks/useI18n";
import type { EnvironmentCheckSnapshot } from "@/lib/environment";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const EnvironmentCheckContent = lazy(async () => {
  const mod = await import("@/components/environment/EnvironmentCheckDialog");
  return { default: mod.EnvironmentCheckContent };
});

function formatMessage(template: string, ...args: Array<string | number>) {
  let out = template;
  args.forEach((arg) => {
    out = out.replace("{}", String(arg));
  });
  return out;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const digits = unitIndex === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

type SettingsCategoryId = "general" | "appearance" | "environment" | "shortcuts" | "about";

interface SettingsCategoryItem {
  id: SettingsCategoryId;
  icon: LucideIcon;
  label: string;
}

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  language: Language;
  onLanguageChange: (language: Language) => void | Promise<void>;
  minimizeToTrayOnClose: boolean;
  onMinimizeToTrayOnCloseChange: (value: boolean) => void;
  defaultOutputDir: string;
  onDefaultOutputDirChange: (dir: string) => void;
  executionHistoryLimit: number;
  onExecutionHistoryLimitChange: (limit: number) => void;
  preRerunChecklistEnabled: boolean;
  onPreRerunChecklistEnabledChange: (value: boolean) => void;
  theme: "light" | "dark" | "auto";
  onThemeChange: (theme: "light" | "dark" | "auto") => void;
  onOpenShortcuts?: () => void;
  environmentStatus?: "unknown" | "ready" | "warning" | "blocked";
  environmentCheckedAt?: string;
  providers: ProviderManifest[];
  environmentProviderIds: string[];
  environmentInitialCheck?: EnvironmentCheckSnapshot | null;
  onEnvironmentProviderIdsChange: (providerIds: string[]) => void;
  onEnvironmentChecked?: (snapshot: EnvironmentCheckSnapshot) => void;
  updaterState: AppUpdaterState;
  onCheckForUpdates: () => Promise<void>;
  onInstallAvailableUpdate: () => Promise<void>;
  onOpenUpdaterHelpTarget: (target: "docs" | "template") => Promise<void>;
}

function SettingsSectionFallback({ label }: { label: string }) {
  return (
    <div className="space-y-3">
      <div className="h-10 rounded-lg border border-[var(--settings-hairline)] bg-[var(--settings-section-bg)]" />
      <div className="h-24 rounded-lg border border-[var(--settings-hairline)] bg-[var(--settings-section-bg)]" />
      <p className="text-xs text-[var(--settings-ink-muted)]">{label}</p>
    </div>
  );
}

function SettingsSwitchRow({
  id,
  icon: Icon,
  label,
  description,
  checked,
  onCheckedChange,
}: {
  id: string;
  icon: LucideIcon;
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
}) {
  return (
    <div className="px-4 py-3.5 hover:bg-black/[0.005] dark:hover:bg-white/[0.005] transition-colors duration-150">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Icon className="size-[18px] flex-shrink-0 text-[var(--settings-ink-muted)]" />
          <div className="space-y-0.5">
            <Label className="cursor-pointer text-[14px] font-semibold tracking-[-0.224px] text-[var(--settings-ink)]" htmlFor={id}>
              {label}
            </Label>
            <p className="text-[12px] leading-[1.4] tracking-[-0.12px] text-[var(--settings-ink-muted)]">
              {description}
            </p>
          </div>
        </div>
        <Switch
          id={id}
          checked={checked}
          onCheckedChange={onCheckedChange}
          className="shrink-0"
        />
      </div>
    </div>
  );
}

export interface GeneralSettingsSectionProps {
  translations: any;
  language: Language;
  onLanguageChange: (nextLanguage: string) => void;
  executionHistoryLimit: number;
  onExecutionHistoryLimitChange: (limit: number) => void;
  defaultOutputDir: string;
  onDefaultOutputDirChange: (dir: string) => void;
  onSelectDirectory: () => void | Promise<void>;
  preRerunChecklistEnabled: boolean;
  onPreRerunChecklistEnabledChange: (value: boolean) => void;
  minimizeToTrayOnClose: boolean;
  onMinimizeToTrayOnCloseChange: (value: boolean) => void;
}

export const GeneralSettingsSection = memo(function GeneralSettingsSection({
  translations,
  language,
  onLanguageChange,
  executionHistoryLimit,
  onExecutionHistoryLimitChange,
  defaultOutputDir,
  onDefaultOutputDirChange,
  onSelectDirectory,
  preRerunChecklistEnabled,
  onPreRerunChecklistEnabledChange,
  minimizeToTrayOnClose,
  onMinimizeToTrayOnCloseChange,
}: GeneralSettingsSectionProps) {
  return (
    <div className="space-y-6">
      {/* 区域与历史分组 */}
      <div className="rounded-xl border border-[var(--settings-hairline)] bg-[var(--settings-section-bg)] overflow-hidden">
        {/* 界面语言 Row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 hover:bg-black/[0.005] dark:hover:bg-white/[0.005] transition-colors duration-150">
          <div className="space-y-0.5">
            <Label htmlFor="settings-language" className="text-[14px] font-semibold tracking-[-0.224px] text-[var(--settings-ink)]">
              {translations.language?.label || "界面语言"}
            </Label>
            <p className="text-[12px] leading-[1.4] tracking-[-0.12px] text-[var(--settings-ink-muted)]">
              {translations.language?.placeholder || "选择应用界面的显示语言"}
            </p>
          </div>
          <div className="w-full sm:w-[180px] shrink-0">
            <Select value={language} onValueChange={onLanguageChange}>
              <SelectTrigger id="settings-language" className="h-9 rounded-lg border-[var(--settings-hairline)] bg-transparent hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                <SelectValue placeholder={translations.language?.placeholder || "选择语言"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="zh">
                  {translations.language?.chinese || "简体中文"}
                </SelectItem>
                <SelectItem value="en">
                  {translations.language?.english || "English"}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="h-px bg-[var(--settings-hairline)] mx-4" />

        {/* 执行历史保留上限 Row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 hover:bg-black/[0.005] dark:hover:bg-white/[0.005] transition-colors duration-150">
          <div className="space-y-0.5">
            <Label htmlFor="settings-execution-history" className="text-[14px] font-semibold tracking-[-0.224px] text-[var(--settings-ink)]">
              {translations.settings?.general?.executionHistoryLimitLabel || "执行历史保留上限"}
            </Label>
            <p className="text-[12px] leading-[1.4] tracking-[-0.12px] text-[var(--settings-ink-muted)]">
              {translations.settings?.general?.executionHistoryLimitDescription || "可设置 5~200 条，超出范围会自动修正。"}
            </p>
          </div>
          <div className="w-full sm:w-[100px] shrink-0">
            <Input
              id="settings-execution-history"
              type="number"
              className="h-9 text-right rounded-lg border-[var(--settings-hairline)] bg-transparent focus-visible:ring-1 focus-visible:ring-[var(--settings-accent)]"
              min={5}
              max={200}
              value={executionHistoryLimit}
              onChange={(e) => {
                const next = Math.trunc(Number(e.target.value));
                if (Number.isNaN(next)) {
                  return;
                }
                const normalized = Math.min(200, Math.max(5, next));
                onExecutionHistoryLimitChange(normalized);
              }}
            />
          </div>
        </div>
      </div>

      {/* 路径偏好分组 */}
      <div className="rounded-xl border border-[var(--settings-hairline)] bg-[var(--settings-section-bg)] overflow-hidden">
        <div className="p-4 space-y-3">
          <div className="space-y-0.5">
            <Label
              htmlFor="settings-default-output-dir"
              className="flex items-center gap-1.5 text-[14px] font-semibold tracking-[-0.224px] text-[var(--settings-ink)]"
            >
              <FolderOpen className="size-4 text-[var(--settings-ink-muted)]" />
              {translations.outputDir?.label || "默认发布目录"}
            </Label>
            <p className="text-[12px] leading-[1.4] tracking-[-0.12px] text-[var(--settings-ink-muted)]">
              {translations.outputDir?.support || "支持相对路径（如 ./publish）或绝对路径"}
            </p>
          </div>
          <div className="flex gap-2">
            <Input
              id="settings-default-output-dir"
              value={defaultOutputDir}
              onChange={(e) => onDefaultOutputDirChange(e.target.value)}
              placeholder={
                translations.outputDir?.placeholder || "留空使用项目默认目录"
              }
              className="h-10 rounded-lg border-[var(--settings-hairline)] bg-transparent focus-visible:ring-1 focus-visible:ring-[var(--settings-accent)]"
            />
            <Button
              variant="outline"
              size="icon"
              className="size-10 shrink-0 active:scale-[0.97] rounded-lg border-[var(--settings-hairline)] bg-transparent hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
              onClick={onSelectDirectory}
              title={translations.outputDir?.label || "选择默认发布目录"}
            >
              <FolderOpen className="size-4 text-[var(--settings-ink-muted)]" />
            </Button>
          </div>
        </div>
      </div>

      {/* 系统行为开关分组 */}
      <div className="rounded-xl border border-[var(--settings-hairline)] bg-[var(--settings-section-bg)] overflow-hidden">
        <SettingsSwitchRow
          id="rerun-checklist-enabled"
          icon={ListChecks}
          label={
            translations.settings?.general?.preRerunChecklistLabel ||
            "重跑前确认清单"
          }
          description={
            translations.settings?.general?.preRerunChecklistDescription ||
            "启用后，点击“重跑记录”会先检查分支、环境和输出目标确认项。"
          }
          checked={preRerunChecklistEnabled}
          onCheckedChange={onPreRerunChecklistEnabledChange}
        />

        <div className="h-px bg-[var(--settings-hairline)] mx-4" />

        <SettingsSwitchRow
          id="minimize-to-tray"
          icon={Minimize2}
          label={translations.tray?.label || "关闭窗口时最小化到托盘"}
          description={
            translations.tray?.description ||
            "启用后点击关闭按钮会隐藏窗口，继续驻留托盘。"
          }
          checked={minimizeToTrayOnClose}
          onCheckedChange={onMinimizeToTrayOnCloseChange}
        />
      </div>
    </div>
  );
});

export interface AppearanceSettingsSectionProps {
  translations: any;
  theme: "light" | "dark" | "auto";
  onThemeChange: (theme: "light" | "dark" | "auto") => void;
}

export const AppearanceSettingsSection = memo(function AppearanceSettingsSection({
  translations,
  theme,
  onThemeChange,
}: AppearanceSettingsSectionProps) {
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-[var(--settings-hairline)] bg-[var(--settings-section-bg)] p-6">
        <div className="flex items-center justify-between mb-4">
          <Label htmlFor="settings-theme" className="text-[14px] font-semibold tracking-[-0.224px] text-[var(--settings-ink)]">
            {translations.theme?.label || "外观主题"}
          </Label>
          <select
            id="settings-theme"
            value={theme}
            onChange={(e) => onThemeChange(e.target.value as "light" | "dark" | "auto")}
            className="sr-only"
            aria-hidden="true"
          >
            <option value="auto">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
        
        <div className="grid grid-cols-3 gap-4">
          {/* 跟随系统 */}
          <button
            type="button"
            className={cn(
              "group relative flex flex-col items-center gap-2 rounded-lg border p-2 text-center transition-all duration-150 active:scale-[0.97]",
              theme === "auto"
                ? "border-[var(--settings-card-selected-border)] bg-[var(--settings-card-selected-bg)]"
                : "border-[var(--settings-hairline)] bg-transparent hover:bg-black/[0.01] dark:hover:bg-white/[0.01]"
            )}
            onClick={() => onThemeChange("auto")}
          >
            {/* 自动主题微缩图 */}
            <div className="relative h-16 w-full overflow-hidden rounded-md border border-[var(--settings-hairline)] bg-gradient-to-br from-[#f5f5f7] via-[#f5f5f7] to-[#1e1e1f] dark:from-[#3a3a3c] dark:to-[#1c1c1e] transition-colors duration-150">
              <div className="absolute inset-y-0 left-0 w-1/2 bg-[#ffffff] dark:bg-[#1e1e1f]" />
              <div className="absolute inset-y-0 right-0 w-1/2 bg-[#f5f5f7] dark:bg-[#2c2c2e]" />
              <div className="absolute top-2 left-2 h-1.5 w-6 rounded-full bg-black/10 dark:bg-white/10" />
              <div className="absolute top-2 right-2 h-1.5 w-6 rounded-full bg-black/5 dark:bg-white/5" />
              <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-transparent to-black/5" />
            </div>
            <span className="text-[12px] font-medium text-[var(--settings-ink)]">
              {translations.theme?.auto || "跟随系统"}
            </span>
          </button>

          {/* 亮色 */}
          <button
            type="button"
            className={cn(
              "group relative flex flex-col items-center gap-2 rounded-lg border p-2 text-center transition-all duration-150 active:scale-[0.97]",
              theme === "light"
                ? "border-[var(--settings-card-selected-border)] bg-[var(--settings-card-selected-bg)]"
                : "border-[var(--settings-hairline)] bg-transparent hover:bg-black/[0.01] dark:hover:bg-white/[0.01]"
            )}
            onClick={() => onThemeChange("light")}
          >
            {/* 亮色主题微缩图 */}
            <div className="relative h-16 w-full overflow-hidden rounded-md border border-[var(--settings-hairline)] bg-[#ffffff] transition-colors duration-150">
              {/* 模拟顶栏 */}
              <div className="h-3 border-b border-[#e0e0e0] bg-[#f5f5f7]" />
              {/* 模拟侧边栏 */}
              <div className="absolute top-3 left-0 bottom-0 w-6 border-r border-[#e0e0e0] bg-[#fafafc]" />
              <div className="absolute top-5 left-8 h-1.5 w-6 rounded-full bg-black/10" />
              <div className="absolute top-9 left-8 h-2.5 w-12 rounded-md bg-[#0066cc]/10" />
            </div>
            <span className="text-[12px] font-medium text-[var(--settings-ink)]">
              {translations.theme?.light || "亮色"}
            </span>
          </button>

          {/* 暗色 */}
          <button
            type="button"
            className={cn(
              "group relative flex flex-col items-center gap-2 rounded-lg border p-2 text-center transition-all duration-150 active:scale-[0.97]",
              theme === "dark"
                ? "border-[var(--settings-card-selected-border)] bg-[var(--settings-card-selected-bg)]"
                : "border-[var(--settings-hairline)] bg-transparent hover:bg-black/[0.01] dark:hover:bg-white/[0.01]"
            )}
            onClick={() => onThemeChange("dark")}
          >
            {/* 暗色主题微缩图 */}
            <div className="relative h-16 w-full overflow-hidden rounded-md border border-[var(--settings-hairline)] bg-[#1e1e1f] transition-colors duration-150">
              {/* 模拟顶栏 */}
              <div className="h-3 border-b border-[#2c2c2e] bg-[#2a2a2c]" />
              {/* 模拟侧边栏 */}
              <div className="absolute top-3 left-0 bottom-0 w-6 border-r border-[#2c2c2e] bg-[#252527]" />
              <div className="absolute top-5 left-8 h-1.5 w-6 rounded-full bg-white/10" />
              <div className="absolute top-9 left-8 h-2.5 w-12 rounded-md bg-[#2997ff]/20" />
            </div>
            <span className="text-[12px] font-medium text-[var(--settings-ink)]">
              {translations.theme?.dark || "暗色"}
            </span>
          </button>
        </div>
      </div>

      <p className="text-[12px] leading-[1.4] tracking-[-0.12px] text-[var(--settings-ink-muted)] px-1">
        {translations.settings?.sections?.appearanceDescription ||
          "主题切换会立即作用到当前窗口与后续打开的设置面板。"}
      </p>
    </div>
  );
});

export interface ShortcutsSettingsSectionProps {
  translations: any;
  shortcutsItems: Array<{ key: string; description: string }>;
  onOpenShortcuts?: () => void;
}

export const ShortcutsSettingsSection = memo(function ShortcutsSettingsSection({
  translations,
  shortcutsItems,
  onOpenShortcuts,
}: ShortcutsSettingsSectionProps) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[var(--settings-hairline)] bg-[var(--settings-section-bg)] overflow-hidden">
        {shortcutsItems.map((shortcut, index) => (
          <div key={shortcut.key}>
            {index > 0 && <div className="h-px bg-[var(--settings-hairline)] mx-4" />}
            <div className="flex items-center justify-between gap-4 p-4 hover:bg-black/[0.005] dark:hover:bg-white/[0.005] transition-colors duration-150">
              <span className="text-[14px] font-medium tracking-[-0.224px] text-[var(--settings-ink)]">
                {shortcut.description}
              </span>
              <kbd className="rounded-md border border-[var(--settings-hairline)] bg-[var(--settings-sidebar-item-active)] px-2 py-0.5 text-[12px] font-semibold tracking-[-0.12px] text-[var(--settings-ink-muted)] font-mono shadow-sm">
                {shortcut.key}
              </kbd>
            </div>
          </div>
        ))}
      </div>

      <Button
        variant="outline"
        className="h-11 w-full justify-start active:scale-[0.97] rounded-xl border-[var(--settings-hairline)] bg-[var(--settings-section-bg)] hover:bg-black/[0.02] dark:hover:bg-white/[0.02] text-[var(--settings-ink)]"
        onClick={onOpenShortcuts}
        disabled={!onOpenShortcuts}
      >
        <Keyboard className="mr-2 size-4 text-[var(--settings-ink-muted)]" />
        {translations.shortcuts?.button || "查看快捷键"}
      </Button>
    </div>
  );
});

export interface UpdaterProgressBarProps {
  translations: any;
  downloadProgress: {
    stage: string;
    attempt?: number;
    maxAttempts?: number;
    downloadedBytes: number;
    totalBytes: number | null;
    percent: number | null;
  };
}

export const UpdaterProgressBar = memo(function UpdaterProgressBar({
  translations,
  downloadProgress,
}: UpdaterProgressBarProps) {
  return (
    <div className="space-y-3 rounded-lg border border-[var(--settings-hairline)] bg-[var(--settings-section-bg)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="text-[14px] font-semibold tracking-[-0.224px] text-[var(--settings-ink)]">
            {downloadProgress.stage === "installing"
              ? translations.version?.installing || "正在安装更新..."
              : translations.version?.downloading || "正在下载更新..."}
          </div>
          <div className="text-[12px] tracking-[-0.12px] text-[var(--settings-ink-muted)]">
            {downloadProgress.stage === "retrying"
              ? formatMessage(
                  translations.version?.retrying ||
                    "下载中断，正在进行第 {} / {} 次尝试",
                  downloadProgress.attempt || 1,
                  downloadProgress.maxAttempts || 1
                )
              : downloadProgress.totalBytes && downloadProgress.totalBytes > 0
                ? formatMessage(
                    translations.version?.downloadProgress ||
                      "已下载 {} / {}",
                    formatBytes(downloadProgress.downloadedBytes),
                    formatBytes(downloadProgress.totalBytes)
                  )
                : formatMessage(
                    translations.version?.downloadProgressUnknown ||
                      "已下载 {}",
                    formatBytes(downloadProgress.downloadedBytes)
                  )}
          </div>
        </div>
        {downloadProgress.percent !== null && (
          <div className="text-[12px] font-semibold tabular-nums tracking-[-0.12px] text-[var(--settings-ink-muted)]">
            {Math.round(downloadProgress.percent)}%
          </div>
        )}
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--settings-sidebar-item-active)]">
        <div
          className={cn(
            "h-full rounded-full bg-[var(--settings-accent)] transition-[width] duration-200",
            downloadProgress.percent === null && "animate-pulse w-1/3"
          )}
          style={
            downloadProgress.percent !== null
              ? { width: `${Math.max(0, Math.min(downloadProgress.percent, 100))}%` }
              : undefined
          }
        />
      </div>
    </div>
  );
});

export function SettingsDialog({
  open: isOpen,
  onOpenChange,
  language,
  onLanguageChange,
  minimizeToTrayOnClose,
  onMinimizeToTrayOnCloseChange,
  defaultOutputDir,
  onDefaultOutputDirChange,
  executionHistoryLimit,
  onExecutionHistoryLimitChange,
  preRerunChecklistEnabled,
  onPreRerunChecklistEnabledChange,
  theme,
  onThemeChange,
  onOpenShortcuts,
  providers,
  environmentProviderIds,
  environmentInitialCheck = null,
  onEnvironmentProviderIdsChange,
  onEnvironmentChecked,
  updaterState,
  onCheckForUpdates,
  onInstallAvailableUpdate,
  onOpenUpdaterHelpTarget: _onOpenUpdaterHelpTarget,
}: SettingsDialogProps) {
  const [activeCategory, setActiveCategory] = useState<SettingsCategoryId>("general");
  const [isRestarting, setIsRestarting] = useState(false);
  const [hasRequestedUpdateCheck, setHasRequestedUpdateCheck] = useState(false);
  const { translations } = useI18n();
  const {
    currentVersion,
    updateInfo,
    isRestartRequired,
    isCheckingUpdate,
    isInstallingUpdate,
    downloadProgress,
  } = updaterState;

  const categoryItems = useMemo<SettingsCategoryItem[]>(
    () => [
      {
        id: "general",
        icon: Languages,
        label: translations.settings?.categories?.general || "\u901A\u7528",
      },
      {
        id: "appearance",
        icon: Palette,
        label: translations.settings?.categories?.appearance || "\u5916\u89C2",
      },
      {
        id: "environment",
        icon: ListChecks,
        label: translations.settings?.categories?.environment || "\u73AF\u5883\u68C0\u67E5",
      },
      {
        id: "shortcuts",
        icon: Keyboard,
        label: translations.settings?.categories?.shortcuts || "\u5FEB\u6377\u952E",
      },
      {
        id: "about",
        icon: Info,
        label: translations.settings?.categories?.about || "\u5173\u4E8E",
      },
    ],
    [translations]
  );

  const activeCategoryItem = useMemo(
    () =>
      categoryItems.find((item) => item.id === activeCategory) ??
      categoryItems[0],
    [activeCategory, categoryItems]
  );

  /** Section descriptions - kept here so sidebar stays icon+label only */
  const categoryDescriptions = useMemo<Record<SettingsCategoryId, string>>(
    () => ({
      general:
        translations.settings?.sections?.generalDescription ||
        "\u7BA1\u7406\u8BED\u8A00\u3001\u9ED8\u8BA4\u8F93\u51FA\u76EE\u5F55\u4E0E\u8FD0\u884C\u504F\u597D\u3002",
      appearance:
        translations.settings?.sections?.appearanceDescription ||
        "\u8C03\u6574\u4E3B\u9898\u663E\u793A\u98CE\u683C\uFF0C\u5339\u914D\u4F60\u7684\u7CFB\u7EDF\u4E0E\u4F7F\u7528\u4E60\u60EF\u3002",
      environment:
        translations.settings?.sections?.environmentDescription ||
        "\u67E5\u770B\u73AF\u5883\u8BCA\u65AD\u7ED3\u679C\u5E76\u5FEB\u901F\u8FDB\u5165\u68C0\u67E5\u9875\u3002",
      shortcuts:
        translations.settings?.sections?.shortcutsDescription ||
        "\u67E5\u770B\u5168\u5C40\u5FEB\u6377\u952E\uFF0C\u63D0\u9AD8\u5E38\u7528\u64CD\u4F5C\u6548\u7387\u3002",
      about:
        translations.settings?.sections?.aboutDescription ||
        "\u67E5\u770B\u7248\u672C\u4FE1\u606F\u3001\u66F4\u65B0\u72B6\u6001\u4E0E\u66F4\u65B0\u65E5\u5FD7\u3002",
    }),
    [translations]
  );

  const shortcutsItems = useMemo(
    () => [
      {
        key: "Cmd/Ctrl + R",
        description: translations.shortcuts?.refresh || "\u5237\u65B0\u9879\u76EE",
      },
      {
        key: "Cmd/Ctrl + P",
        description: translations.shortcuts?.publish || "\u6267\u884C\u53D1\u5E03",
      },
      {
        key: "Cmd/Ctrl + ,",
        description: translations.shortcuts?.settings || "\u6253\u5F00\u8BBE\u7F6E",
      },
    ],
    [
      translations.shortcuts?.publish,
      translations.shortcuts?.refresh,
      translations.shortcuts?.settings,
    ]
  );

  const handleLanguageChange = useCallback(
    (nextLanguage: string) => {
      if ((nextLanguage !== "zh" && nextLanguage !== "en") || nextLanguage === language) {
        return;
      }

      const normalizedLanguage = nextLanguage as Language;

      void Promise.resolve(onLanguageChange(normalizedLanguage))
        .then(() => {
          const languageLabel =
            normalizedLanguage === "en"
              ? t("language.english")
              : t("language.chinese");

          toast.success(
            t("language.changed", {
              language: languageLabel,
            })
          );
        })
        .catch((error) => {
          console.error("\u5207\u6362\u8BED\u8A00\u5931\u8D25:", error);
          toast.error(t("language.changeFailed"));
        });
    },
    [language, onLanguageChange]
  );

  const handleCategoryChange = useCallback(
    (nextCategory: SettingsCategoryId) => {
      if (nextCategory === activeCategory) {
        return;
      }

      startTransition(() => {
        setActiveCategory(nextCategory);
      });
    },
    [activeCategory]
  );

  const handleCheckUpdate = useCallback(() => {
    setHasRequestedUpdateCheck(true);
    void onCheckForUpdates();
  }, [onCheckForUpdates]);

  const shouldHideDefaultUpdaterConfigMessage =
    !hasRequestedUpdateCheck &&
    Boolean(
      updateInfo?.message?.includes("\u66F4\u65B0\u6E90\u672A\u914D\u7F6E\u6216\u4E0D\u53EF\u7528:") &&
        updateInfo.message.includes("endpoints") &&
        updateInfo.message.includes("pubkey")
    );

  const handleInstallUpdate = useCallback(() => {
    void onInstallAvailableUpdate();
  }, [onInstallAvailableUpdate]);

  useEffect(() => {
    if (!isOpen) {
      setHasRequestedUpdateCheck(false);
    }
  }, [isOpen]);

  const handleRestartApp = useCallback(() => {
    if (!isTauri()) {
      return;
    }

    setIsRestarting(true);

    void relaunch().catch((error) => {
      console.error("\u91CD\u542F\u5E94\u7528\u5931\u8D25:", error);
      setIsRestarting(false);
      toast.error(
        translations.version?.restartFailed || "\u91CD\u542F\u5E94\u7528\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5"
      );
    });
  }, [translations.version?.restartFailed]);

  const handleSelectDirectory = useCallback(async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: translations.outputDir?.label || "\u9009\u62E9\u9ED8\u8BA4\u53D1\u5E03\u76EE\u5F55",
      });
      if (selected) {
        onDefaultOutputDirChange(selected as string);
      }
    } catch (err) {
      console.error("\u9009\u62E9\u76EE\u5F55\u5931\u8D25:", err);
    }
  }, [onDefaultOutputDirChange, translations.outputDir?.label]);

  const renderGeneralSettings = () => (
    <GeneralSettingsSection
      translations={translations}
      language={language}
      onLanguageChange={handleLanguageChange}
      executionHistoryLimit={executionHistoryLimit}
      onExecutionHistoryLimitChange={onExecutionHistoryLimitChange}
      defaultOutputDir={defaultOutputDir}
      onDefaultOutputDirChange={onDefaultOutputDirChange}
      onSelectDirectory={handleSelectDirectory}
      preRerunChecklistEnabled={preRerunChecklistEnabled}
      onPreRerunChecklistEnabledChange={onPreRerunChecklistEnabledChange}
      minimizeToTrayOnClose={minimizeToTrayOnClose}
      onMinimizeToTrayOnCloseChange={onMinimizeToTrayOnCloseChange}
    />
  );

  const renderAppearanceSettings = () => (
    <AppearanceSettingsSection
      translations={translations}
      theme={theme}
      onThemeChange={onThemeChange}
    />
  );

  const renderEnvironmentSettings = () => (
    <Suspense
      fallback={
        <SettingsSectionFallback
          label={translations.app?.loading || "加载中..."}
        />
      }
    >
      <EnvironmentCheckContent
        active={isOpen && activeCategory === "environment"}
        providers={providers}
        defaultProviderIds={environmentProviderIds}
        initialCheck={environmentInitialCheck}
        onChecked={onEnvironmentChecked}
        onProviderIdsChange={onEnvironmentProviderIdsChange}
      />
    </Suspense>
  );

  const renderShortcutsSettings = () => (
    <ShortcutsSettingsSection
      translations={translations}
      shortcutsItems={shortcutsItems}
      onOpenShortcuts={onOpenShortcuts}
    />
  );

  const renderAboutSettings = () => (
    <div className="space-y-5">
        <div className="flex flex-col gap-4 rounded-lg border border-[var(--settings-hairline)] bg-[var(--settings-section-bg)] p-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <div className="text-[14px] font-semibold tracking-[-0.224px] text-[var(--settings-ink)]">
              {formatMessage(
                t("version.current"),
                updateInfo?.currentVersion || currentVersion || "—"
              )}
            </div>
            {updateInfo?.hasUpdate && (
              <div className="text-[14px] tracking-[-0.224px] text-[var(--settings-accent)]">
                {formatMessage(t("version.new"), updateInfo.availableVersion || "")}
              </div>
            )}
            {!updateInfo && (
              <div className="text-[12px] tracking-[-0.12px] text-[var(--settings-ink-muted)]">
                {translations.version?.clickToCheck || "点击检查更新以获取最新版本信息"}
              </div>
            )}
            {updateInfo && !updateInfo.hasUpdate && !updateInfo.message && (
              <div className="text-[12px] tracking-[-0.12px] text-[var(--settings-ink-muted)]">
                {translations.version?.none || "没有可用的更新"}
              </div>
            )}
            {updateInfo?.message && !shouldHideDefaultUpdaterConfigMessage && (
              <div className="text-[12px] tracking-[-0.12px] text-[var(--settings-ink-muted)]">
                {updateInfo.message}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {isTauri() && isRestartRequired && (
              <Button
                variant="outline"
                size="sm"
                className="active:scale-[0.97]"
                onClick={handleRestartApp}
                disabled={isRestarting || isCheckingUpdate || isInstallingUpdate}
              >
                {isRestarting ? (
                  <RefreshCw className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                <span className="ml-1">
                  {isRestarting
                    ? translations.version?.restarting || "重启中..."
                    : translations.version?.restart || "重启应用"}
                </span>
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="active:scale-[0.97]"
              onClick={handleCheckUpdate}
              disabled={isCheckingUpdate || isInstallingUpdate}
            >
              {isCheckingUpdate ? (
                <RefreshCw className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              <span className="ml-1">{translations.version?.check || "检查更新"}</span>
            </Button>
            {updateInfo?.hasUpdate && !isRestartRequired && (
              <Button
                variant="default"
                size="sm"
                className="active:scale-[0.97]"
                onClick={handleInstallUpdate}
                disabled={isInstallingUpdate}
              >
                {isInstallingUpdate ? (
                  <RefreshCw className="size-4 animate-spin" />
                ) : (
                  <Download className="size-4" />
                )}
                <span className="ml-1">{translations.version?.update || "更新"}</span>
              </Button>
            )}
          </div>
        </div>
 
        {isInstallingUpdate && (
          <UpdaterProgressBar
            translations={translations}
            downloadProgress={downloadProgress}
          />
        )}
 
        {updateInfo?.releaseNotes && (
          <div className="max-h-56 overflow-y-auto rounded-lg border border-[var(--settings-hairline)] bg-[var(--settings-section-bg)] p-4 glass-scrollbar text-[12px] tracking-[-0.12px] text-[var(--settings-ink)]">
            <div className="mb-1.5 font-semibold">
              {translations.version?.notes || "更新说明:"}
            </div>
            <div className="whitespace-pre-wrap text-[var(--settings-ink-muted)]">{updateInfo.releaseNotes}</div>
          </div>
        )}
      </div>
  );

  const renderCategoryContent = () => {
    switch (activeCategory) {
      case "general":
        return renderGeneralSettings();
      case "appearance":
        return renderAppearanceSettings();
      case "environment":
        return renderEnvironmentSettings();
      case "shortcuts":
        return renderShortcutsSettings();
      case "about":
        return renderAboutSettings();
      default:
        return renderGeneralSettings();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <AppDialogShell
        size="workspace"
        bodyPadding="none"
        bodyScrollable={false}
        bodyInnerClassName="min-h-0 h-full"
        title={translations.settings?.title || "应用设置"}
        description={
          translations.settings?.description || "配置语言、外观、输出目录等偏好设置"
        }
        icon={undefined}
        surfaceClassName="bg-white dark:bg-[#1d1d1f] border border-[var(--settings-hairline)] shadow-2xl"
        headerClassName="border-[var(--settings-hairline)] bg-transparent"
        titleClassName="text-[17px] font-semibold text-[var(--settings-ink)]"
        descriptionClassName="text-[13px] text-[var(--settings-ink-muted)]"
      >
        <div className="grid h-full min-h-0 gap-0 sm:grid-cols-[200px_minmax(0,1fr)] bg-white dark:bg-[#1d1d1f]">
          {/* Sidebar */}
          <aside className="min-h-0 overflow-y-auto border-r border-[var(--settings-hairline)] bg-[#f5f5f7]/50 dark:bg-[#252527]/50 px-3 py-4 glass-scrollbar">
            <nav className="flex gap-0.5 overflow-x-auto sm:flex-col sm:overflow-visible">
              {categoryItems.map((item) => {
                const Icon = item.icon;
                const isActive = item.id === activeCategory;

                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-all duration-150 active:scale-[0.97]",
                      isActive
                        ? "bg-[var(--settings-sidebar-selected-bg)] text-[var(--settings-sidebar-selected-text)] shadow-sm font-semibold"
                        : "text-[var(--settings-ink)]/80 hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
                    )}
                    onClick={() => handleCategoryChange(item.id)}
                  >
                    <Icon
                      className={cn(
                        "size-[18px] flex-shrink-0 transition-colors duration-150",
                        isActive
                          ? "text-[var(--settings-sidebar-selected-text)]"
                          : "text-[var(--settings-icon-muted)]"
                      )}
                    />
                    <span className="truncate text-[13px] font-semibold tracking-[-0.12px]">
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </nav>
          </aside>

          {/* Content */}
          <section className="min-h-0 flex flex-col overflow-hidden bg-white dark:bg-[#1d1d1f]">
            <div className="border-b border-[var(--settings-hairline)] px-6 pb-4 pt-5">
              <h3 className="text-[17px] font-semibold tracking-[-0.374px] text-[var(--settings-ink)]">
                {activeCategoryItem.label}
              </h3>
              <p className="mt-0.5 text-[14px] leading-[1.43] tracking-[-0.224px] text-[var(--settings-ink-muted)]">
                {categoryDescriptions[activeCategory]}
              </p>
            </div>
            <div className="glass-scrollbar min-h-0 flex-1 overflow-y-auto px-6 py-5">
              {renderCategoryContent()}
            </div>
          </section>
        </div>
      </AppDialogShell>
    </Dialog>
  );
}
