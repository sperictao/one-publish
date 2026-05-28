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
    <div className="rounded-lg border border-[var(--settings-hairline)] bg-[var(--settings-section-bg)] px-4 py-3.5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Icon className="size-[18px] flex-shrink-0 text-[var(--settings-ink-muted)]" />
          <Label className="cursor-pointer text-[14px] font-semibold tracking-[-0.224px] text-[var(--settings-ink)]" htmlFor={id}>
            {label}
          </Label>
        </div>
        <Switch
          id={id}
          checked={checked}
          onCheckedChange={onCheckedChange}
        />
      </div>
      <p className="mt-1.5 pl-[30px] text-[12px] leading-[1.4] tracking-[-0.12px] text-[var(--settings-ink-muted)]">
        {description}
      </p>
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
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="settings-language" className="text-[14px] font-semibold tracking-[-0.224px] text-[var(--settings-ink)]">
            {translations.language?.label || "界面语言"}
          </Label>
          <Select value={language} onValueChange={onLanguageChange}>
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
          <Label htmlFor="settings-execution-history" className="text-[14px] font-semibold tracking-[-0.224px] text-[var(--settings-ink)]">
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
          <p className="text-[12px] leading-[1.4] tracking-[-0.12px] text-[var(--settings-ink-muted)]">
            {translations.settings?.general?.executionHistoryLimitDescription ||
              "可设置 5~200 条，超出范围会自动修正并即时生效。"}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Label
          htmlFor="settings-default-output-dir"
          className="flex items-center gap-2 text-[14px] font-semibold tracking-[-0.224px] text-[var(--settings-ink)]"
        >
          <FolderOpen className="size-4 text-[var(--settings-ink-muted)]" />
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
            className="size-10 shrink-0 active:scale-[0.97]"
            onClick={onSelectDirectory}
            title={translations.outputDir?.label || "选择默认发布目录"}
          >
            <FolderOpen className="size-4" />
          </Button>
        </div>
        <p className="text-[12px] leading-[1.4] tracking-[-0.12px] text-[var(--settings-ink-muted)]">
          {translations.outputDir?.support ||
            "支持相对路径（如 ./publish）或绝对路径"}
        </p>
      </div>

      <div className="h-px bg-[var(--settings-hairline)]" />

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
    <div className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="settings-theme" className="flex items-center gap-2 text-[14px] font-semibold tracking-[-0.224px] text-[var(--settings-ink)]">
            <Palette className="size-4 text-[var(--settings-ink-muted)]" />
            {translations.theme?.label || "\u5916\u89C2\u4E3B\u9898"}
          </Label>
          <Select value={theme} onValueChange={onThemeChange}>
            <SelectTrigger id="settings-theme">
              <SelectValue
                placeholder={translations.theme?.placeholder || "\u9009\u62E9\u4E3B\u9898"}
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">
                <div className="flex items-center gap-2">
                  <Monitor className="size-4" />
                  <span>{translations.theme?.auto || "\u8DDF\u968F\u7CFB\u7EDF"}</span>
                </div>
              </SelectItem>
              <SelectItem value="light">
                <div className="flex items-center gap-2">
                  <Sun className="size-4" />
                  <span>{translations.theme?.light || "\u4EAE\u8272"}</span>
                </div>
              </SelectItem>
              <SelectItem value="dark">
                <div className="flex items-center gap-2">
                  <Moon className="size-4" />
                  <span>{translations.theme?.dark || "\u6697\u8272"}</span>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <p className="text-[12px] leading-[1.4] tracking-[-0.12px] text-[var(--settings-ink-muted)]">
          {translations.settings?.sections?.appearanceDescription ||
            "\u4E3B\u9898\u5207\u6362\u4F1A\u7ACB\u5373\u4F5C\u7528\u5230\u5F53\u524D\u7A97\u53E3\u4E0E\u540E\u7EED\u6253\u5F00\u7684\u8BBE\u7F6E\u9762\u677F\u3002"}
        </p>
      </div>
  );

  const renderEnvironmentSettings = () => (
    <Suspense
      fallback={
        <SettingsSectionFallback
          label={translations.app?.loading || "\u52A0\u8F7D\u4E2D..."}
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
              className="flex items-center justify-between rounded-lg border border-[var(--settings-hairline)] bg-[var(--settings-section-bg)] px-4 py-3"
            >
              <span className="text-[14px] tracking-[-0.224px] text-[var(--settings-ink)]">{shortcut.description}</span>
              <kbd className="rounded-md border border-[var(--settings-hairline)] bg-[var(--settings-sidebar-item-active)] px-2.5 py-1 text-[12px] font-semibold tracking-[-0.12px] text-[var(--settings-ink-muted)]">
                {shortcut.key}
              </kbd>
            </div>
          ))}

          <Button
            variant="outline"
            className="h-11 w-full justify-start active:scale-[0.97]"
            onClick={onOpenShortcuts}
            disabled={!onOpenShortcuts}
          >
            <Keyboard className="mr-2 size-4" />
            {translations.shortcuts?.button || "\u67E5\u770B\u5FEB\u6377\u952E"}
          </Button>
        </div>
    );
  };

  const renderAboutSettings = () => (
    <div className="space-y-5">
        <div className="flex flex-col gap-4 rounded-lg border border-[var(--settings-hairline)] bg-[var(--settings-section-bg)] p-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <div className="text-[14px] font-semibold tracking-[-0.224px] text-[var(--settings-ink)]">
              {formatMessage(
                t("version.current"),
                updateInfo?.currentVersion || currentVersion || "\u2014"
              )}
            </div>
            {updateInfo?.hasUpdate && (
              <div className="text-[14px] tracking-[-0.224px] text-[var(--settings-accent)]">
                {formatMessage(t("version.new"), updateInfo.availableVersion || "")}
              </div>
            )}
            {!updateInfo && (
              <div className="text-[12px] tracking-[-0.12px] text-[var(--settings-ink-muted)]">
                {translations.version?.clickToCheck || "\u70B9\u51FB\u68C0\u67E5\u66F4\u65B0\u4EE5\u83B7\u53D6\u6700\u65B0\u7248\u672C\u4FE1\u606F"}
              </div>
            )}
            {updateInfo && !updateInfo.hasUpdate && !updateInfo.message && (
              <div className="text-[12px] tracking-[-0.12px] text-[var(--settings-ink-muted)]">
                {translations.version?.none || "\u6CA1\u6709\u53EF\u7528\u7684\u66F4\u65B0"}
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
                    ? translations.version?.restarting || "\u91CD\u542F\u4E2D..."
                    : translations.version?.restart || "\u91CD\u542F\u5E94\u7528"}
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
              <span className="ml-1">{translations.version?.check || "\u68C0\u67E5\u66F4\u65B0"}</span>
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
                <span className="ml-1">{translations.version?.update || "\u66F4\u65B0"}</span>
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
              {translations.version?.notes || "\u66F4\u65B0\u8BF4\u660E:"}
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
        title={translations.settings?.title || "\u5E94\u7528\u8BBE\u7F6E"}
        description={
          translations.settings?.description || "\u914D\u7F6E\u8BED\u8A00\u3001\u5916\u89C2\u3001\u8F93\u51FA\u76EE\u5F55\u7B49\u504F\u597D\u8BBE\u7F6E"
        }
        icon={<Languages className="size-4" />}
      >
        <div className="grid h-full min-h-0 gap-0 sm:grid-cols-[200px_minmax(0,1fr)]">
          {/* Sidebar */}
          <aside className="min-h-0 overflow-y-auto border-r border-[var(--settings-hairline)] px-3 py-4 glass-scrollbar">
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
                      "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors duration-150",
                      isActive
                        ? "bg-[var(--settings-sidebar-item-active)] text-[var(--settings-ink)]"
                        : "text-[var(--settings-ink-muted)] hover:bg-[var(--settings-sidebar-item-hover)] hover:text-[var(--settings-ink)]"
                    )}
                    onClick={() => handleCategoryChange(item.id)}
                  >
                    <Icon
                      className={cn(
                        "size-[18px] flex-shrink-0 transition-colors duration-150",
                        isActive
                          ? "text-[var(--settings-icon-active)]"
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
          <section className="min-h-0 flex flex-col overflow-hidden">
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
