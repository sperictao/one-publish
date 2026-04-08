import {
  Dialog,
} from "@/components/ui/dialog";
import { AppDialogInset } from "@/components/ui/app-dialog-inset";
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
  Monitor,
  Moon,
  Sun,
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
  description: string;
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
      <div className="h-10 rounded-xl border border-[var(--glass-border-subtle)] bg-[var(--glass-input-bg)]" />
      <div className="h-24 rounded-xl border border-[var(--glass-border-subtle)] bg-[var(--glass-input-bg)]" />
      <p className="text-xs text-muted-foreground">{label}</p>
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
    <AppDialogInset className="flex items-start justify-between gap-4">
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-background/60 text-foreground/75">
            <Icon className="h-4 w-4" />
          </span>
          <Label className="cursor-pointer text-sm font-medium" htmlFor={id}>
            {label}
          </Label>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          {description}
        </p>
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
      />
    </AppDialogInset>
  );
}

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
        label: translations.settings?.categories?.general || "通用",
        description:
          translations.settings?.sections?.generalDescription ||
          "管理语言、默认输出目录与运行偏好。",
      },
      {
        id: "appearance",
        icon: Palette,
        label: translations.settings?.categories?.appearance || "外观",
        description:
          translations.settings?.sections?.appearanceDescription ||
          "调整主题显示风格，匹配你的系统与使用习惯。",
      },
      {
        id: "environment",
        icon: ListChecks,
        label: translations.settings?.categories?.environment || "环境检查",
        description:
          translations.settings?.sections?.environmentDescription ||
          "查看环境诊断结果并快速进入检查页。",
      },
      {
        id: "shortcuts",
        icon: Keyboard,
        label: translations.settings?.categories?.shortcuts || "快捷键",
        description:
          translations.settings?.sections?.shortcutsDescription ||
          "查看全局快捷键，提高常用操作效率。",
      },
      {
        id: "about",
        icon: Info,
        label: translations.settings?.categories?.about || "关于",
        description:
          translations.settings?.sections?.aboutDescription ||
          "查看版本信息、更新状态与更新日志。",
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

  const shortcutsItems = useMemo(
    () => [
      {
        key: "Cmd/Ctrl + R",
        description: translations.shortcuts?.refresh || "刷新项目",
      },
      {
        key: "Cmd/Ctrl + P",
        description: translations.shortcuts?.publish || "执行发布",
      },
      {
        key: "Cmd/Ctrl + ,",
        description: translations.shortcuts?.settings || "打开设置",
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
          console.error("切换语言失败:", error);
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
      updateInfo?.message?.includes("更新源未配置或不可用:") &&
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
      console.error("重启应用失败:", error);
      setIsRestarting(false);
      toast.error(
        translations.version?.restartFailed || "重启应用失败，请稍后重试"
      );
    });
  }, [translations.version?.restartFailed]);

  const handleSelectDirectory = async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: translations.outputDir?.label || "选择默认发布目录",
      });
      if (selected) {
        onDefaultOutputDirChange(selected as string);
      }
    } catch (err) {
      console.error("选择目录失败:", err);
    }
  };

  const renderGeneralSettings = () => (
    <div className="space-y-4">
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="settings-language">
              {translations.language?.label || "界面语言"}
            </Label>
            <Select value={language} onValueChange={handleLanguageChange}>
              <SelectTrigger id="settings-language">
                <SelectValue
                  placeholder={translations.language?.placeholder || "选择语言"}
                />
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

          <div className="space-y-2">
            <Label htmlFor="settings-execution-history">
              {translations.settings?.general?.executionHistoryLimitLabel ||
                "执行历史保留上限"}
            </Label>
            <Input
              id="settings-execution-history"
              type="number"
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
            <p className="text-xs leading-5 text-muted-foreground">
              {translations.settings?.general?.executionHistoryLimitDescription ||
                "可设置 5~200 条，超出范围会自动修正并即时生效。"}
            </p>
          </div>
        </div>

        <AppDialogInset>
          <div className="space-y-2">
            <Label
              htmlFor="settings-default-output-dir"
              className="flex items-center gap-2"
            >
              <FolderOpen className="h-4 w-4" />
              {translations.outputDir?.label || "默认发布目录"}
            </Label>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <Input
                id="settings-default-output-dir"
                value={defaultOutputDir}
                onChange={(e) => onDefaultOutputDirChange(e.target.value)}
                placeholder={
                  translations.outputDir?.placeholder || "留空使用项目默认目录"
                }
              />
              <Button
                variant="outline"
                size="icon"
                className="h-10 w-10 shrink-0"
                onClick={handleSelectDirectory}
                title={translations.outputDir?.label || "选择默认发布目录"}
              >
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              {translations.outputDir?.support ||
                "支持相对路径（如 ./publish）或绝对路径"}
            </p>
          </div>
        </AppDialogInset>

        <div className="space-y-3">
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

  const renderAppearanceSettings = () => (
    <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="settings-theme" className="flex items-center gap-2">
            <Palette className="h-4 w-4" />
            {translations.theme?.label || "外观主题"}
          </Label>
          <Select value={theme} onValueChange={onThemeChange}>
            <SelectTrigger id="settings-theme">
              <SelectValue
                placeholder={translations.theme?.placeholder || "选择主题"}
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">
                <div className="flex items-center gap-2">
                  <Monitor className="h-4 w-4" />
                  <span>{translations.theme?.auto || "跟随系统"}</span>
                </div>
              </SelectItem>
              <SelectItem value="light">
                <div className="flex items-center gap-2">
                  <Sun className="h-4 w-4" />
                  <span>{translations.theme?.light || "亮色"}</span>
                </div>
              </SelectItem>
              <SelectItem value="dark">
                <div className="flex items-center gap-2">
                  <Moon className="h-4 w-4" />
                  <span>{translations.theme?.dark || "暗色"}</span>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <AppDialogInset>
          <p className="text-xs leading-5 text-muted-foreground">
            {translations.settings?.sections?.appearanceDescription ||
              "主题切换会立即作用到当前窗口与后续打开的设置面板。"}
          </p>
        </AppDialogInset>
      </div>
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

  const renderShortcutsSettings = () => {
    return (
      <div className="space-y-3">
          {shortcutsItems.map((shortcut) => (
            <div
              key={shortcut.key}
              className="flex items-center justify-between rounded-2xl border border-[var(--glass-border-subtle)] bg-[var(--glass-input-bg)] px-4 py-3 glass-transition"
            >
              <span className="text-sm">{shortcut.description}</span>
              <kbd className="rounded-lg border border-[var(--glass-kbd-border)] bg-[var(--glass-kbd-bg)] px-2 py-1 text-xs font-semibold">
                {shortcut.key}
              </kbd>
            </div>
          ))}

          <Button
            variant="outline"
            className="h-11 w-full justify-start"
            onClick={onOpenShortcuts}
            disabled={!onOpenShortcuts}
          >
            <Keyboard className="mr-2 h-4 w-4" />
            {translations.shortcuts?.button || "查看快捷键"}
          </Button>
        </div>
    );
  };

  const renderAboutSettings = () => (
    <div className="space-y-4">
        <AppDialogInset className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <div className="text-sm font-medium">
              {formatMessage(
                t("version.current"),
                updateInfo?.currentVersion || currentVersion || "—"
              )}
            </div>
            {updateInfo?.hasUpdate && (
              <div className="text-sm text-green-600 dark:text-green-400">
                {formatMessage(t("version.new"), updateInfo.availableVersion || "")}
              </div>
            )}
            {!updateInfo && (
              <div className="text-xs text-muted-foreground">
                {translations.version?.clickToCheck || "点击检查更新以获取最新版本信息"}
              </div>
            )}
            {updateInfo && !updateInfo.hasUpdate && !updateInfo.message && (
              <div className="text-xs text-muted-foreground">
                {translations.version?.none || "没有可用的更新"}
              </div>
            )}
            {updateInfo?.message && !shouldHideDefaultUpdaterConfigMessage && (
              <div className="text-xs text-muted-foreground">
                {updateInfo.message}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {isTauri() && isRestartRequired && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleRestartApp}
                disabled={isRestarting || isCheckingUpdate || isInstallingUpdate}
              >
                {isRestarting ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
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
              onClick={handleCheckUpdate}
              disabled={isCheckingUpdate || isInstallingUpdate}
            >
              {isCheckingUpdate ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              <span className="ml-1">{translations.version?.check || "检查更新"}</span>
            </Button>
            {updateInfo?.hasUpdate && !isRestartRequired && (
              <Button
                variant="default"
                size="sm"
                onClick={handleInstallUpdate}
                disabled={isInstallingUpdate}
              >
                {isInstallingUpdate ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                <span className="ml-1">{translations.version?.update || "更新"}</span>
              </Button>
            )}
          </div>
        </AppDialogInset>

        {isInstallingUpdate && (
          <AppDialogInset className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-sm font-medium">
                  {downloadProgress.stage === "installing"
                    ? translations.version?.installing || "正在安装更新..."
                    : translations.version?.downloading || "正在下载更新..."}
                </div>
                <div className="text-xs text-muted-foreground">
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
                <div className="text-xs font-medium tabular-nums text-muted-foreground">
                  {Math.round(downloadProgress.percent)}%
                </div>
              )}
            </div>

            <div className="h-2 overflow-hidden rounded-full bg-[var(--glass-input-bg)]">
              <div
                className={cn(
                  "h-full rounded-full bg-primary transition-[width] duration-200",
                  downloadProgress.percent === null && "animate-pulse w-1/3"
                )}
                style={
                  downloadProgress.percent !== null
                    ? { width: `${Math.max(0, Math.min(downloadProgress.percent, 100))}%` }
                    : undefined
                }
              />
            </div>
          </AppDialogInset>
        )}

        {updateInfo?.releaseNotes && (
          <AppDialogInset className="max-h-56 overflow-y-auto glass-scrollbar text-xs">
            <div className="mb-1 font-medium">
              {translations.version?.notes || "更新说明:"}
            </div>
            <div className="whitespace-pre-wrap">{updateInfo.releaseNotes}</div>
          </AppDialogInset>
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

  const ActiveCategoryIcon = activeCategoryItem.icon;

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
        icon={<Languages className="h-4 w-4" />}
      >
        <div className="grid h-full min-h-0 gap-5 p-5 sm:grid-cols-[240px_minmax(0,1fr)] sm:p-6">
          <aside className="glass-card min-h-0 overflow-y-auto rounded-2xl p-2.5">
            <nav className="flex gap-2 overflow-x-auto pb-1 sm:flex-col sm:overflow-visible sm:pb-0">
              {categoryItems.map((item) => {
                const Icon = item.icon;
                const isActive = item.id === activeCategory;

                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "glass-press flex min-w-[170px] items-start gap-3 rounded-2xl border px-3.5 py-3 text-left glass-transition sm:min-w-0",
                      isActive
                        ? "border-[var(--glass-border)] bg-[var(--glass-bg-active)] text-foreground shadow-[var(--glass-shadow)]"
                        : "border-transparent text-muted-foreground hover:border-[var(--glass-border-subtle)] hover:bg-[var(--glass-input-bg)] hover:text-foreground"
                    )}
                    onClick={() => handleCategoryChange(item.id)}
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl",
                        isActive
                          ? "bg-primary/10 text-primary shadow-[var(--glass-inset-shadow)]"
                          : "bg-[var(--glass-input-bg)] text-foreground/70"
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {item.label}
                      </span>
                      <span className="mt-1 block text-[11px] leading-4 text-muted-foreground">
                        {item.description}
                      </span>
                    </span>
                  </button>
                );
              })}
            </nav>
          </aside>

          <section className="glass-card min-h-0 flex flex-col overflow-hidden rounded-2xl">
            <div className="border-b border-[var(--glass-divider)] px-5 pb-4 pt-5 sm:px-6 sm:pb-4 sm:pt-6">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-[0_8px_20px_hsl(var(--primary)/0.16)]">
                  <ActiveCategoryIcon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-foreground">
                    {activeCategoryItem.label}
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {activeCategoryItem.description}
                  </p>
                </div>
              </div>
            </div>
            <div className="glass-scrollbar min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
              {renderCategoryContent()}
            </div>
          </section>
        </div>
      </AppDialogShell>
    </Dialog>
  );
}
