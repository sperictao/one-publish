import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  Sliders,
  FileText,
  FileCog,
  ListChecks,
  Keyboard,
  type LucideIcon,
} from "lucide-react";
import { useState, useCallback } from "react";
import {
  checkUpdate,
  installUpdate,
  getUpdaterHelpPaths,
  getUpdaterConfigHealth,
  openUpdaterHelp,
} from "@/lib/store";
import type { UpdateInfo } from "@/lib/store";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useI18n, t } from "@/hooks/useI18n";
import type { Language } from "@/hooks/useI18n";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

function formatMessage(template: string, ...args: Array<string | number>) {
  let out = template;
  args.forEach((arg) => {
    out = out.replace("{}", String(arg));
  });
  return out;
}

type SettingsCategoryId = "general" | "appearance" | "environment" | "shortcuts" | "config" | "about";

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
  onOpenConfig?: () => void;
  environmentStatus?: "unknown" | "ready" | "warning" | "blocked";
  environmentCheckedAt?: string;
  onOpenEnvironment?: () => void;
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
  onOpenConfig,
  environmentStatus = "unknown",
  environmentCheckedAt,
  onOpenEnvironment,
}: SettingsDialogProps) {
  const [activeCategory, setActiveCategory] = useState<SettingsCategoryId>("general");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false);
  const [isOpeningUpdaterHelp, setIsOpeningUpdaterHelp] = useState(false);
  const [updaterHelpPaths, setUpdaterHelpPaths] = useState<{
    docsPath: string;
    templatePath: string;
  } | null>(null);
  const [updaterConfigHealth, setUpdaterConfigHealth] = useState<{
    configured: boolean;
    message: string;
  } | null>(null);
  const { translations } = useI18n();

  const categoryItems: SettingsCategoryItem[] = [
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
      id: "config",
      icon: Sliders,
      label: translations.settings?.categories?.config || "配置管理",
      description:
        translations.settings?.sections?.configDescription ||
        "管理发布配置模板与参数预设。",
    },
    {
      id: "about",
      icon: Info,
      label: translations.settings?.categories?.about || "关于",
      description:
        translations.settings?.sections?.aboutDescription ||
        "查看版本信息、更新状态与更新日志。",
    },
  ];

  const activeCategoryItem =
    categoryItems.find((item) => item.id === activeCategory) ?? categoryItems[0];

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

  const handleCheckUpdate = async () => {
    setIsCheckingUpdate(true);
    try {
      const info = await checkUpdate();
      setUpdateInfo(info);

      const health = await getUpdaterConfigHealth();
      setUpdaterConfigHealth(health);

      if (
        info.message?.includes("更新源未配置") ||
        info.message?.includes("updater")
      ) {
        const paths = await getUpdaterHelpPaths();
        setUpdaterHelpPaths(paths);
      } else {
        setUpdaterHelpPaths(null);
      }
    } catch (err) {
      console.error("检查更新失败:", err);
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const handleOpenUpdaterHelp = async (target: "docs" | "template") => {
    setIsOpeningUpdaterHelp(true);
    try {
      await openUpdaterHelp(target);
    } catch (err) {
      console.error("打开 updater 帮助失败:", err);
    } finally {
      setIsOpeningUpdaterHelp(false);
    }
  };

  const handleInstallUpdate = async () => {
    setIsInstallingUpdate(true);
    try {
      const message = await installUpdate();
      const info = await checkUpdate();
      setUpdateInfo({
        ...info,
        message: message || info.message,
      });
    } catch (err) {
      console.error("安装更新失败:", err);
      setUpdateInfo((prev) => ({
        currentVersion: prev?.currentVersion || "0.1.0",
        availableVersion: prev?.availableVersion || null,
        hasUpdate: prev?.hasUpdate || false,
        releaseNotes: prev?.releaseNotes || null,
        message: String(err),
      }));
    } finally {
      setIsInstallingUpdate(false);
    }
  };

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
    <div className="space-y-6">
      <div className="space-y-2">
        <Label>{translations.language?.label || "界面语言"}</Label>
        <Select value={language} onValueChange={handleLanguageChange}>
          <SelectTrigger>
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

      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          <FolderOpen className="h-4 w-4" />
          {translations.outputDir?.label || "默认发布目录"}
        </Label>
        <div className="flex gap-2">
          <Input
            value={defaultOutputDir}
            onChange={(e) => onDefaultOutputDirChange(e.target.value)}
            placeholder={translations.outputDir?.placeholder || "留空使用项目默认目录"}
          />
          <Button
            variant="outline"
            size="icon"
            onClick={handleSelectDirectory}
            title="选择目录"
          >
            <FolderOpen className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {translations.outputDir?.support || "支持相对路径（如 ./publish）或绝对路径"}
        </p>
      </div>

      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          <Info className="h-4 w-4" />
          执行历史保留上限
        </Label>
        <Input
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
        <p className="text-xs text-muted-foreground">
          可设置 5~200 条，超出范围会自动修正并即时生效。
        </p>
      </div>

      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-muted-foreground" />
            <Label className="cursor-pointer" htmlFor="rerun-checklist-enabled">
              重跑前确认清单
            </Label>
          </div>
          <p className="text-xs text-muted-foreground">
            启用后，点击“重跑记录”会先检查分支、环境和输出目标确认项。
          </p>
        </div>
        <Switch
          id="rerun-checklist-enabled"
          checked={preRerunChecklistEnabled}
          onCheckedChange={onPreRerunChecklistEnabledChange}
        />
      </div>

      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Minimize2 className="h-4 w-4 text-muted-foreground" />
            <Label className="cursor-pointer" htmlFor="minimize-to-tray">
              {translations.tray?.label || "关闭窗口时最小化到托盘"}
            </Label>
          </div>
          <p className="text-xs text-muted-foreground">
            {translations.tray?.description ||
              "启用后点击关闭按钮会隐藏窗口，继续驻留托盘。"}
          </p>
        </div>
        <Switch
          id="minimize-to-tray"
          checked={minimizeToTrayOnClose}
          onCheckedChange={onMinimizeToTrayOnCloseChange}
        />
      </div>

    </div>
  );

  const renderAppearanceSettings = () => (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          <Palette className="h-4 w-4" />
          {translations.theme?.label || "外观主题"}
        </Label>
        <Select value={theme} onValueChange={onThemeChange}>
          <SelectTrigger>
            <SelectValue placeholder={translations.theme?.placeholder || "选择主题"} />
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
    </div>
  );

  const renderEnvironmentSettings = () => (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          <Info className="h-4 w-4" />
          {translations.environment?.title || "环境检查"}
        </Label>
        <div className="flex items-center justify-between gap-3 rounded-xl bg-[var(--glass-input-bg)] border border-[var(--glass-border-subtle)] p-3">
          <div className="space-y-1">
            <div className="text-sm font-medium">
              {translations.environment?.status || "环境状态"}: {" "}
              {environmentStatus === "ready"
                ? translations.environment?.ready || "已就绪"
                : environmentStatus === "warning"
                  ? translations.environment?.warning || "存在警告"
                  : environmentStatus === "blocked"
                    ? translations.environment?.blocked || "存在阻断问题"
                    : translations.environment?.unknown || "未检查"}
            </div>
            {environmentCheckedAt && (
              <div className="text-xs text-muted-foreground">
                {environmentCheckedAt}
              </div>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onOpenEnvironment}
            disabled={!onOpenEnvironment}
          >
            {translations.environment?.title || "环境检查"}
          </Button>
        </div>
      </div>
    </div>
  );

  const renderShortcutsSettings = () => {
    const shortcutItems = [
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
    ];

    return (
      <div className="space-y-6">
        <div className="space-y-2">
          {shortcutItems.map((shortcut) => (
            <div
              key={shortcut.key}
              className="flex items-center justify-between rounded-xl bg-[var(--glass-input-bg)] px-3 py-2 glass-transition"
            >
              <span className="text-sm">{shortcut.description}</span>
              <kbd className="rounded-lg border border-[var(--glass-kbd-border)] bg-[var(--glass-kbd-bg)] px-2 py-1 text-xs font-semibold">
                {shortcut.key}
              </kbd>
            </div>
          ))}
        </div>

        <Button
          variant="outline"
          className="w-full justify-start"
          onClick={onOpenShortcuts}
          disabled={!onOpenShortcuts}
        >
          <Keyboard className="mr-2 h-4 w-4" />
          {translations.shortcuts?.button || "查看快捷键"}
        </Button>
      </div>
    );
  };

  const renderConfigSettings = () => (
    <div className="space-y-6">
      <div className="rounded-xl border border-[var(--glass-border-subtle)] bg-[var(--glass-input-bg)] p-4">
        <div className="space-y-3">
          <div className="space-y-1">
            <div className="text-sm font-medium">
              {translations.config?.button || "配置管理"}
            </div>
            <p className="text-xs text-muted-foreground">
              管理发布配置模板、参数预设以及命令行为。
            </p>
          </div>
          <Button
            variant="outline"
            onClick={onOpenConfig}
            disabled={!onOpenConfig}
            className="w-full justify-start"
          >
            <Sliders className="mr-2 h-4 w-4" />
            {translations.config?.button || "配置管理"}
          </Button>
        </div>
      </div>
    </div>
  );

  const renderAboutSettings = () => (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          <Info className="h-4 w-4" />
          {translations.version?.title || "版本信息"}
        </Label>
        <div className="flex flex-col gap-3 rounded-xl bg-[var(--glass-input-bg)] border border-[var(--glass-border-subtle)] p-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <div className="text-sm font-medium">
              {formatMessage(
                t("version.current"),
                updateInfo?.currentVersion || "0.1.0"
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
            {updateInfo?.message && (
              <div className="text-xs text-muted-foreground">
                {updateInfo.message}
              </div>
            )}
            {updaterConfigHealth && (
              <div
                className={cn(
                  "text-xs",
                  updaterConfigHealth.configured ? "text-green-600" : "text-yellow-600"
                )}
              >
                {translations.version?.configStatus || "配置状态"}: {updaterConfigHealth.message}
              </div>
            )}
            {updaterHelpPaths && (
              <div className="flex flex-col gap-2 pt-1">
                <div className="break-all font-mono text-xs text-muted-foreground">
                  {updaterHelpPaths.docsPath}
                </div>
                <div className="break-all font-mono text-xs text-muted-foreground">
                  {updaterHelpPaths.templatePath}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isOpeningUpdaterHelp}
                    onClick={() => handleOpenUpdaterHelp("docs")}
                  >
                    <FileText className="mr-1 h-4 w-4" />
                    {translations.version?.openGuide || "打开配置指南"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isOpeningUpdaterHelp}
                    onClick={() => handleOpenUpdaterHelp("template")}
                  >
                    <FileCog className="mr-1 h-4 w-4" />
                    {translations.version?.openTemplate || "打开模板文件"}
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2">
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
            {updateInfo?.hasUpdate && (
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
        </div>
      </div>

      {updateInfo?.releaseNotes && (
        <div className="max-h-40 overflow-y-auto rounded-xl bg-[var(--glass-input-bg)] p-3 text-xs">
          <div className="mb-1 font-medium">
            {translations.version?.notes || "更新说明:"}
          </div>
          <div className="whitespace-pre-wrap">{updateInfo.releaseNotes}</div>
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
      case "config":
        return renderConfigSettings();
      case "about":
        return renderAboutSettings();
      default:
        return renderGeneralSettings();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[860px] h-[72vh] grid-rows-[auto_1fr]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Languages className="h-5 w-5" />
            {translations.settings?.title || "应用设置"}
          </DialogTitle>
          <DialogDescription>
            {translations.settings?.description || "配置语言、外观、输出目录等偏好设置"}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4 sm:grid-cols-[190px_minmax(0,1fr)] min-h-0">
          <aside className="glass-surface rounded-2xl p-2 min-h-0 overflow-y-auto">
            <nav className="flex gap-1 overflow-x-auto pb-1 sm:flex-col sm:overflow-visible sm:pb-0">
              {categoryItems.map((item) => {
                const Icon = item.icon;
                const isActive = item.id === activeCategory;

                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "glass-press flex min-w-[110px] items-center gap-2 rounded-xl px-3 py-2 text-left text-sm glass-transition sm:min-w-0",
                      isActive
                        ? "bg-[var(--glass-bg-active)] text-foreground shadow-[var(--glass-shadow)]"
                        : "text-muted-foreground hover:bg-[var(--glass-bg)] hover:text-foreground"
                    )}
                    onClick={() => setActiveCategory(item.id)}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>

          <section className="overflow-y-auto glass-scrollbar rounded-2xl border border-[var(--glass-border-subtle)] bg-[var(--glass-bg)] p-4 min-h-0">
            <div className="mb-4 space-y-1 border-b border-[var(--glass-divider)] pb-3">
              <h3 className="text-sm font-semibold">{activeCategoryItem.label}</h3>
              <p className="text-xs text-muted-foreground">
                {activeCategoryItem.description}
              </p>
            </div>
            {renderCategoryContent()}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
