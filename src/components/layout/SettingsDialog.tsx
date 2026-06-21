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
  CheckCircle2,
  AlertTriangle,
  ArrowUpCircle,
  ExternalLink,
  Terminal,
  Check,
  type LucideIcon,
} from "lucide-react";
import {
  Suspense,
  lazy,
  memo,
  startTransition,
  useCallback,
  useMemo,
  useState,
} from "react";
import type { ProviderManifest } from "@/lib/store/types";
import { isTauri } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import type { AppUpdaterState } from "@/hooks/useAppUpdater";
import { useI18n } from "@/hooks/useI18n";
import type { Language } from "@/hooks/useI18n";
import type { EnvironmentCheckSnapshot } from "@/features/environment/environment";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useAccentColor, ACCENT_COLORS } from "@/hooks/useTheme";
import type { AccentColor } from "@/hooks/useTheme";
import { ThemePreviewMock } from "./ThemePreviewMock";

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

// ── Geist surface recipes (DESIGN.md) ──
// Section tiles live inside the dialog shell; opaque Geist surfaces with
// borders first, subtle shadows. Depth reads from tonal surfaces, not blur.
const GEIST_CARD =
  "rounded-sm border border-border bg-card shadow-raised overflow-hidden";
const GEIST_CARD_PAD = "rounded-sm border border-border bg-card shadow-raised";
const GEIST_ROW_HOVER =
  "hover:bg-accent transition-colors duration-150 ease-geist";
const GEIST_DIVIDER = "h-px bg-border";
const GEIST_INPUT =
  "surface-input";
const GEIST_KBD =
  "rounded-sm border border-border bg-muted";
const GEIST_CODE_BG =
  "bg-muted border border-border";

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
      <div className={cn("h-10", GEIST_CARD)} />
      <div className={cn("h-24", GEIST_CARD)} />
      <p className="text-label-12 text-muted-foreground">{label}</p>
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
    <div className={cn("px-4 py-3.5", GEIST_ROW_HOVER)}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Icon className="size-[18px] flex-shrink-0 text-muted-foreground" />
          <div className="space-y-0.5">
            <Label className="cursor-pointer text-heading-14 font-semibold text-foreground" htmlFor={id}>
              {label}
            </Label>
            <p className="text-label-12 text-muted-foreground">
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
      <div className={GEIST_CARD}>
        {/* 界面语言 Row */}
        <div className={cn("flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4", GEIST_ROW_HOVER)}>
          <div className="space-y-0.5">
            <Label htmlFor="settings-language" className="text-heading-14 font-semibold text-foreground">
              {translations.language?.label || "界面语言"}
            </Label>
            <p className="text-label-12 text-muted-foreground">
              {translations.language?.placeholder || "选择应用界面的显示语言"}
            </p>
          </div>
          <div className="w-full sm:w-[180px] shrink-0">
            <Select value={language} onValueChange={onLanguageChange}>
              <SelectTrigger id="settings-language" className={cn("h-9 rounded-md", GEIST_INPUT, "hover:bg-accent")}>
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

        <div className={cn(GEIST_DIVIDER, "mx-4")} />

        {/* 执行历史保留上限 Row */}
        <div className={cn("flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4", GEIST_ROW_HOVER)}>
          <div className="space-y-0.5">
            <Label htmlFor="settings-execution-history" className="text-heading-14 font-semibold text-foreground">
              {translations.settings?.general?.executionHistoryLimitLabel || "执行历史保留上限"}
            </Label>
            <p className="text-label-12 text-muted-foreground">
              {translations.settings?.general?.executionHistoryLimitDescription || "可设置 5~200 条，超出范围会自动修正。"}
            </p>
          </div>
          <div className="w-full sm:w-[100px] shrink-0">
            <Input
              id="settings-execution-history"
              type="number"
              className={cn("h-9 text-right rounded-md", GEIST_INPUT)}
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
      <div className={GEIST_CARD_PAD}>
        <div className="p-4 space-y-3">
          <div className="space-y-0.5">
            <Label
              htmlFor="settings-default-output-dir"
              className="flex items-center gap-1.5 text-heading-14 font-semibold text-foreground"
            >
              <FolderOpen className="size-4 text-muted-foreground" />
              {translations.outputDir?.label || "默认发布目录"}
            </Label>
            <p className="text-label-12 text-muted-foreground">
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
              className={cn("h-10 rounded-md", GEIST_INPUT)}
            />
            <Button
              variant="outline"
              size="icon"
              className={cn("size-10 shrink-0 rounded-md", GEIST_INPUT)}
              onClick={onSelectDirectory}
              title={translations.outputDir?.browse || "浏览目录"}
              aria-label={translations.outputDir?.browse || "浏览目录"}
            >
              <FolderOpen className="size-4 text-muted-foreground" />
            </Button>
          </div>
        </div>
      </div>

      {/* 系统行为开关分组 */}
      <div className={GEIST_CARD}>
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

        <div className={cn(GEIST_DIVIDER, "mx-4")} />

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
  const { accentColor, setAccentColor } = useAccentColor();
  const appearanceT = translations.settings?.appearance || {};

  const accentList: Array<{ id: AccentColor; name: string; lightColor: string; darkColor: string }> = [
    { id: "brand", name: appearanceT.accentBrand || "Geist 蓝", lightColor: "#006bff", darkColor: "#006efe" },
    { id: "blue", name: appearanceT.accentBlue || "系统蓝", lightColor: "#006bff", darkColor: "#006efe" },
    { id: "purple", name: appearanceT.accentPurple || "紫色", lightColor: "#a000f8", darkColor: "#9440d5" },
    { id: "pink", name: appearanceT.accentPink || "粉色", lightColor: "#f22782", darkColor: "#f12b82" },
    { id: "red", name: appearanceT.accentRed || "红色", lightColor: "#ea001d", darkColor: "#f32e40" },
    { id: "orange", name: appearanceT.accentOrange || "橙色", lightColor: "#ffae00", darkColor: "#ffae00" },
    { id: "yellow", name: appearanceT.accentYellow || "黄色", lightColor: "#ffa600", darkColor: "#ed9a00" },
    { id: "green", name: appearanceT.accentGreen || "绿色", lightColor: "#28a948", darkColor: "#00ac3a" },
    { id: "gray", name: appearanceT.accentGray || "石墨", lightColor: "#4d4d4d", darkColor: "#a0a0a0" },
  ];

  const activeColorToken = ACCENT_COLORS[accentColor] || ACCENT_COLORS.blue;
  const lightPreviewColor = `hsl(${activeColorToken.light.accent})`;
  const darkPreviewColor = `hsl(${activeColorToken.dark.accent})`;

  const themeCardBase =
    "group relative flex flex-col items-center gap-2.5 rounded-md border p-2.5 text-center transition-colors duration-150 ease-geist";
  const themeCardSelected =
    "border-interactive bg-interactive/10 shadow-raised";
  const themeCardUnselected =
    "border-border bg-card hover:bg-accent";
  const themeCheckBadge =
    "absolute top-1.5 right-1.5 flex size-4 items-center justify-center rounded-full bg-interactive text-interactive-foreground border border-border animate-in zoom-in-50 duration-200 z-10";

  return (
    <div className="space-y-6">
      {/* 主题选择卡片 */}
      <div className={cn(GEIST_CARD_PAD, "p-6")}>
        <div className="flex items-center justify-between mb-4">
          <Label htmlFor="settings-theme" className="text-heading-14 font-semibold text-foreground">
            {translations.theme?.label || "外观主题"}
          </Label>
          <select
            id="settings-theme"
            value={theme}
            onChange={(e) => onThemeChange(e.target.value as "light" | "dark" | "auto")}
            className="sr-only"
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
              themeCardBase,
              theme === "auto" ? themeCardSelected : themeCardUnselected
            )}
            onClick={() => onThemeChange("auto")}
          >
            {theme === "auto" && (
              <div className={themeCheckBadge}>
                <Check className="size-2.5 stroke-[3.5]" />
              </div>
            )}

            {/* 自动主题微缩图 */}
            <div className="relative h-20 w-full overflow-hidden rounded-md border border-border flex select-none pointer-events-none">
              <div className="w-1/2 border-r border-border">
                <ThemePreviewMock
                  theme="light"
                  previewColor={lightPreviewColor}
                  sidebarWidth={14}
                  showAllSidebarLines={false}
                  className="rounded-none border-none shadow-none"
                />
              </div>
              <div className="w-1/2">
                <ThemePreviewMock
                  theme="dark"
                  previewColor={darkPreviewColor}
                  hideSidebar
                  showAllSidebarLines={false}
                  className="rounded-none border-none shadow-none"
                />
              </div>
            </div>
            <span className="text-label-12 font-semibold text-foreground">
              {translations.theme?.auto || "跟随系统"}
            </span>
          </button>

          {/* 亮色 */}
          <button
            type="button"
            className={cn(
              themeCardBase,
              theme === "light" ? themeCardSelected : themeCardUnselected
            )}
            onClick={() => onThemeChange("light")}
          >
            {theme === "light" && (
              <div className={themeCheckBadge}>
                <Check className="size-2.5 stroke-[3.5]" />
              </div>
            )}
            {/* 亮色主题微缩图 */}
            <ThemePreviewMock theme="light" previewColor={lightPreviewColor} />
            <span className="text-label-12 font-semibold text-foreground">
              {translations.theme?.light || "亮色"}
            </span>
          </button>

          {/* 暗色 */}
          <button
            type="button"
            className={cn(
              themeCardBase,
              theme === "dark" ? themeCardSelected : themeCardUnselected
            )}
            onClick={() => onThemeChange("dark")}
          >
            {theme === "dark" && (
              <div className={themeCheckBadge}>
                <Check className="size-2.5 stroke-[3.5]" />
              </div>
            )}
            {/* 暗色主题微缩图 */}
            <ThemePreviewMock theme="dark" previewColor={darkPreviewColor} />
            <span className="text-label-12 font-semibold text-foreground">
              {translations.theme?.dark || "暗色"}
            </span>
          </button>
        </div>
      </div>

      {/* 强调色选择卡片 */}
      <div className={cn(GEIST_CARD_PAD, "p-6")}>
        <div className="space-y-0.5 mb-4">
          <Label className="text-heading-14 font-semibold text-foreground">
            {appearanceT.accentColorTitle || "强调色 (Accent Color)"}
          </Label>
          <p className="text-label-12 text-muted-foreground">
            {appearanceT.accentColorDescription || "选择应用在聚焦框、激活项、链接和高亮状态下的系统强调色。"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {accentList.map((item) => {
            const isSelected = item.id === accentColor;
            return (
              <button
                key={item.id}
                type="button"
                className={cn(
                  "relative flex size-7 shrink-0 items-center justify-center rounded-full transition-colors duration-150 ease-geist hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-interactive",
                  isSelected
                    ? "ring-2 ring-offset-2 ring-interactive"
                    : ""
                )}
                style={{
                  background: `linear-gradient(135deg, ${item.lightColor} 50%, ${item.darkColor} 50%)`,
                }}
                onClick={() => setAccentColor(item.id)}
                title={item.name}
                aria-label={(appearanceT.accentColorAriaLabel || "强调色: {{name}}").replace("{{name}}", item.name)}
              >
                {isSelected && (
                  <Check className="size-3 text-white stroke-[3.5]" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <p className="text-label-12 text-muted-foreground px-1">
        {translations.settings?.sections?.appearanceDescription ||
          "主题与强调色切换会立即作用到当前窗口与后续打开的设置面板。"}
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
      <div className={GEIST_CARD}>
        {shortcutsItems.map((shortcut, index) => (
          <div key={shortcut.key}>
            {index > 0 && <div className={cn(GEIST_DIVIDER, "mx-4")} />}
            <div className={cn("flex items-center justify-between gap-4 p-4", GEIST_ROW_HOVER)}>
              <span className="text-heading-14 font-semibold text-foreground">
                {shortcut.description}
              </span>
              <kbd className={cn(GEIST_KBD, "px-2.5 py-0.5 text-label-12 font-semibold text-foreground font-sans shrink-0")}>
                {shortcut.key}
              </kbd>
            </div>
          </div>
        ))}
      </div>

      <Button
        variant="outline"
        className={cn("h-11 w-full justify-start rounded-md", GEIST_INPUT, "text-foreground")}
        onClick={onOpenShortcuts}
        disabled={!onOpenShortcuts}
      >
        <Keyboard className="mr-2 size-4 text-muted-foreground" />
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
    <div className={cn("space-y-3 p-4 transition-colors duration-150 ease-geist", GEIST_CODE_BG, "rounded-md")}>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="text-heading-14 font-semibold text-foreground">
            {downloadProgress.stage === "installing"
              ? translations.version?.installing || "正在安装更新..."
              : translations.version?.downloading || "正在下载更新..."}
          </div>
          <div className="text-label-12 font-normal text-muted-foreground">
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
          <div className={cn("text-label-13 font-semibold tabular-nums font-mono text-foreground px-2 py-0.5 rounded-sm", GEIST_INPUT)}>
            {Math.round(downloadProgress.percent)}%
          </div>
        )}
      </div>

      <div className="h-2 overflow-hidden rounded-full bg-muted border border-border">
        <div
          className={cn(
            "h-full rounded-full bg-interactive origin-left transition-transform duration-150 ease-geist",
            downloadProgress.percent === null && "animate-pulse w-1/3"
          )}
          style={
            downloadProgress.percent !== null
              ? { transform: `scaleX(${Math.max(0, Math.min(downloadProgress.percent, 100)) / 100})` }
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
    updaterConfigHealth,
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
          const languageT = translations.language || {};
          const languageLabel =
            normalizedLanguage === "en"
              ? languageT.english || "English"
              : languageT.chinese || "简体中文";

          toast.success(
            (languageT.changed || "界面语言已切换为 {{language}}").replace(
              "{{language}}",
              languageLabel
            )
          );
        })
        .catch((error) => {
          console.error("\u5207\u6362\u8BED\u8A00\u5931\u8D25:", error);
          toast.error(
            translations.language?.changeFailed ||
              "界面语言切换失败，请重试"
          );
        });
    },
    [language, onLanguageChange, translations.language]
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

  const handleSettingsOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        setHasRequestedUpdateCheck(false);
      }
      onOpenChange(open);
    },
    [onOpenChange]
  );

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

  const generalSettingsContent = (
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

  const appearanceSettingsContent = (
    <AppearanceSettingsSection
      translations={translations}
      theme={theme}
      onThemeChange={onThemeChange}
    />
  );

  const environmentSettingsContent = (
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

  const shortcutsSettingsContent = (
    <ShortcutsSettingsSection
      translations={translations}
      shortcutsItems={shortcutsItems}
      onOpenShortcuts={onOpenShortcuts}
    />
  );

  const aboutSettingsContent = (() => {
    const isConfigUnhealthy = updaterConfigHealth && !updaterConfigHealth.configured;
    const versionT = translations.version || {};
    const lastCheckedAt = new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

    const actionButtonBase =
      "h-8 px-3 rounded-md text-button-12 font-normal text-foreground transition-colors duration-150 ease-geist shrink-0 flex items-center gap-1.5";

    return (
      <div className="space-y-6">
        {/* Product Info & Update Status Group */}
        <div className={GEIST_CARD}>
          {/* Brand Row */}
          <div className={cn("flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4", GEIST_ROW_HOVER)}>
            <div className="space-y-0.5 min-w-0">
              <p className="text-heading-14 font-semibold text-foreground">
                OnePublish
              </p>
              <p className="text-label-12 text-muted-foreground">
                {versionT.productDescription || "跨平台 .NET 自动化发布与签名客户端"}
              </p>
            </div>
            <span className={cn("inline-flex items-center rounded-sm px-2 py-0.5 text-label-12 font-semibold text-muted-foreground font-mono shrink-0", GEIST_INPUT)}>
              {formatMessage(
                versionT.current || "当前版本: v{}",
                updateInfo?.currentVersion || currentVersion || "—"
              )}
            </span>
          </div>

          <div className={cn(GEIST_DIVIDER, "mx-4")} />

          {/* Dynamic Update Row */}
          <div className={cn("flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4", GEIST_ROW_HOVER)}>
            <div className="flex items-center gap-3 min-w-0">
              {isConfigUnhealthy ? (
                <>
                  <AlertTriangle className="size-[18px] flex-shrink-0 text-warning" />
                  <div className="space-y-0.5 min-w-0">
                    <Label className="text-heading-14 font-semibold text-foreground">
                      {versionT.updateChannelNotConfiguredTitle || "更新通道未配置"}
                    </Label>
                    <p className="text-label-12 text-muted-foreground">
                      {versionT.updateChannelNotConfiguredDescription || "检测到本地更新配置未设置，无法建立版本检查。"}
                    </p>
                  </div>
                </>
              ) : isRestartRequired ? (
                <>
                  <RefreshCw className="size-[18px] flex-shrink-0 text-success" />
                  <div className="space-y-0.5 min-w-0">
                    <Label className="text-heading-14 font-semibold text-foreground">
                      {versionT.updateReadyTitle || "新版本已准备就绪"}
                    </Label>
                    <p className="text-label-12 text-muted-foreground">
                      {versionT.updateReadyDescription || "升级补丁已下载完成，请重启客户端应用更新。"}
                    </p>
                  </div>
                </>
              ) : updateInfo?.hasUpdate ? (
                <>
                  <ArrowUpCircle className="size-[18px] flex-shrink-0 text-interactive" />
                  <div className="space-y-0.5 min-w-0">
                    <Label className="text-heading-14 font-semibold text-foreground">
                      {formatMessage(versionT.new || "有新版本: v{}", updateInfo.availableVersion || "")}
                    </Label>
                    <p className="text-label-12 text-muted-foreground">
                      {versionT.updateAvailableDescription || "发现可用新版本。"}
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <CheckCircle2 className="size-[18px] flex-shrink-0 text-success" />
                  <div className="space-y-0.5 min-w-0">
                    <Label className="text-heading-14 font-semibold text-foreground">
                      {versionT.upToDateTitle || "软件已是最新版本"}
                    </Label>
                    <p className="text-label-12 text-muted-foreground">
                      {formatMessage(versionT.lastCheckedAt || "上次检查时间：{}。", lastCheckedAt)}
                    </p>
                  </div>
                </>
              )}
            </div>

            {/* Actions Buttons (Right) */}
            <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
              {isConfigUnhealthy ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(actionButtonBase, GEIST_INPUT)}
                    onClick={() => _onOpenUpdaterHelpTarget("docs")}
                  >
                    <span>{translations.version?.openGuide || "打开配置指南"}</span>
                    <ExternalLink className="size-3 text-muted-foreground" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(actionButtonBase, GEIST_INPUT)}
                    onClick={() => _onOpenUpdaterHelpTarget("template")}
                  >
                    <span>{translations.version?.openTemplate || "下载模板文件"}</span>
                    <Download className="size-3 text-muted-foreground" />
                  </Button>
                </div>
              ) : (
                <>
                  {isTauri() && isRestartRequired && (
                    <Button
                      variant="default"
                      size="sm"
                      className="h-8 px-3 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors duration-150 ease-geist font-semibold text-button-12 shrink-0 flex items-center gap-1.5"
                      onClick={handleRestartApp}
                      disabled={isRestarting || isCheckingUpdate || isInstallingUpdate}
                    >
                      <RefreshCw className={cn("size-3", isRestarting && "animate-spin")} />
                      <span>
                        {isRestarting
                          ? translations.version?.restarting || "重启中..."
                          : translations.version?.restart || "重启应用"}
                      </span>
                    </Button>
                  )}

                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(actionButtonBase, GEIST_INPUT)}
                    onClick={handleCheckUpdate}
                    disabled={isCheckingUpdate || isInstallingUpdate}
                  >
                    <RefreshCw className={cn("size-3 text-muted-foreground", isCheckingUpdate && "animate-spin")} />
                    <span>{translations.version?.check || "检查更新"}</span>
                  </Button>

                  {updateInfo?.hasUpdate && !isRestartRequired && (
                    <Button
                      variant="default"
                      size="sm"
                      className="h-8 px-3 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors duration-150 ease-geist font-semibold text-button-12 shrink-0 flex items-center gap-1.5"
                      onClick={handleInstallUpdate}
                      disabled={isInstallingUpdate}
                    >
                      <Download className="size-3" />
                      <span>{translations.version?.update || "立即更新"}</span>
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>

          {updateInfo?.message && !shouldHideDefaultUpdaterConfigMessage && (
            <div className="p-4 border-t border-border bg-destructive/5">
              <div className="rounded-md border border-destructive/20 bg-destructive/5 p-3 text-label-12 text-destructive font-normal">
                {updateInfo.message}
              </div>
            </div>
          )}

          {isInstallingUpdate && (
            <div className="p-4 border-t border-border">
              <UpdaterProgressBar
                translations={translations}
                downloadProgress={downloadProgress}
              />
            </div>
          )}
        </div>

        {/* Release Notes */}
        {updateInfo?.releaseNotes && (
          <div className={GEIST_CARD}>
            <div className={cn("flex items-center gap-3 p-4 border-b border-border", GEIST_ROW_HOVER)}>
              <Terminal className="size-[18px] text-muted-foreground" />
              <span className="text-heading-14 font-semibold text-foreground">
                {translations.version?.notes || "发布日志"}
              </span>
            </div>
            <div className="p-4">
              <div className={cn("max-h-56 overflow-y-auto geist-scrollbar text-label-12 text-muted-foreground whitespace-pre-wrap font-normal rounded-md p-3", GEIST_CODE_BG)}>
                {updateInfo.releaseNotes}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  })();

  const categoryContent = (() => {
    switch (activeCategory) {
      case "general":
        return generalSettingsContent;
      case "appearance":
        return appearanceSettingsContent;
      case "environment":
        return environmentSettingsContent;
      case "shortcuts":
        return shortcutsSettingsContent;
      case "about":
        return aboutSettingsContent;
      default:
        return generalSettingsContent;
    }
  })();

  return (
    <Dialog open={isOpen} onOpenChange={handleSettingsOpenChange}>
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
        headerClassName="border-b border-border bg-transparent"
        titleClassName="text-heading-16 font-semibold text-foreground"
        descriptionClassName="text-label-13 text-muted-foreground"
      >
        <div className="grid h-full min-h-0 gap-0 sm:grid-cols-[200px_minmax(0,1fr)]">
          {/* Sidebar */}
          <aside className="min-h-0 overflow-y-auto border-r border-border bg-transparent px-3 py-4 geist-scrollbar">
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
                      "group relative flex w-full items-center gap-2.5 rounded-md pl-4 pr-3 py-2 text-left transition-colors duration-150 ease-geist",
                      isActive
                        ? "bg-accent text-foreground font-semibold"
                        : "text-foreground/80 hover:bg-accent"
                    )}
                    onClick={() => handleCategoryChange(item.id)}
                  >
                    {isActive && (
                      <div className="absolute left-1.5 w-1 h-3.5 rounded-full bg-interactive transition-colors duration-150 ease-geist" />
                    )}
                    <Icon
                      className={cn(
                        "size-[18px] flex-shrink-0 transition-colors duration-150 ease-geist",
                        isActive
                          ? "text-interactive"
                          : "text-muted-foreground"
                      )}
                    />
                    <span className="truncate text-label-13 font-semibold">
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </nav>
          </aside>

          {/* Content */}
          <section className="min-h-0 flex flex-col overflow-hidden bg-transparent">
            <div className="px-6 pb-2 pt-4">
              <h2 className="text-heading-16 font-semibold text-foreground">
                {activeCategoryItem.label}
              </h2>
              <p className="mt-0.5 text-label-12 text-muted-foreground">
                {categoryDescriptions[activeCategory]}
              </p>
            </div>
            <div className="geist-scrollbar min-h-0 flex-1 overflow-y-auto px-6 py-4">
              {categoryContent}
            </div>
          </section>
        </div>
      </AppDialogShell>
    </Dialog>
  );
}
