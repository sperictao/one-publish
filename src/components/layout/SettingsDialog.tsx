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
} from "lucide-react";
import { useState } from "react";
import { checkUpdate, installUpdate } from "@/lib/store";
import type { UpdateInfo } from "@/lib/store";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useI18n, t } from "@/hooks/useI18n";
import type { Language } from "@/hooks/useI18n";

function formatMessage(template: string, ...args: Array<string | number>) {
  let out = template;
  args.forEach((arg) => {
    out = out.replace("{}", String(arg));
  });
  return out;
}

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  language: Language;
  onLanguageChange: (language: Language) => void;
  minimizeToTrayOnClose: boolean;
  onMinimizeToTrayOnCloseChange: (value: boolean) => void;
  defaultOutputDir: string;
  onDefaultOutputDirChange: (dir: string) => void;
  theme: "light" | "dark" | "auto";
  onThemeChange: (theme: "light" | "dark" | "auto") => void;
  onOpenShortcuts?: () => void;
  onOpenConfig?: () => void;
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
  theme,
  onThemeChange,
  onOpenShortcuts,
  onOpenConfig,
}: SettingsDialogProps) {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false);
  const { translations } = useI18n();

  const handleCheckUpdate = async () => {
    setIsCheckingUpdate(true);
    try {
      const info = await checkUpdate();
      setUpdateInfo(info);
    } catch (err) {
      console.error("检查更新失败:", err);
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const handleInstallUpdate = async () => {
    setIsInstallingUpdate(true);
    try {
      await installUpdate();
    } catch (err) {
      console.error("安装更新失败:", err);
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

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Languages className="h-5 w-5" />
            {translations.settings?.title || "应用设置"}
          </DialogTitle>
          <DialogDescription>
            {translations.settings?.description || "配置语言、外观、输出目录等偏好设置"}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-6 py-4 max-h-[70vh] overflow-y-auto">
          {/* Version Info */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Info className="h-4 w-4" />
              {translations.version?.title || "版本信息"}
            </Label>
            <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
              <div className="space-y-1">
                <div className="text-sm font-medium">
                  {formatMessage(
                    t("version.current"),
                    updateInfo?.currentVersion || "1.0.0",
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
            {updateInfo?.releaseNotes && (
              <div className="p-3 bg-muted rounded-lg text-xs max-h-40 overflow-y-auto">
                <div className="font-medium mb-1">
                  {translations.version?.notes || "更新说明:"}
                </div>
                <div className="whitespace-pre-wrap">{updateInfo.releaseNotes}</div>
              </div>
            )}
          </div>

          {/* Language Selection */}
          <div className="space-y-2">
            <Label>{translations.language?.label || "界面语言"}</Label>
            <Select value={language} onValueChange={onLanguageChange}>
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

          {/* Theme Selection */}
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

          {/* Default Output Directory */}
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

          {/* Minimize to Tray Toggle */}
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Minimize2 className="h-4 w-4 text-muted-foreground" />
                <Label className="cursor-pointer" htmlFor="minimize-to-tray">
                  {translations.tray?.label || "关闭窗口时最小化到托盘"}
                </Label>
              </div>
              <p className="text-xs text-muted-foreground">
                {translations.tray?.description || "启用后点击关闭按钮会隐藏窗口，继续驻留托盘。"}
              </p>
            </div>
            <Switch
              id="minimize-to-tray"
              checked={minimizeToTrayOnClose}
              onCheckedChange={onMinimizeToTrayOnCloseChange}
            />
          </div>

          {/* Keyboard Shortcuts */}
          <Button
            variant="outline"
            className="w-full"
            onClick={onOpenShortcuts}
          >
            <Info className="h-4 w-4 mr-2" />
            {translations.shortcuts?.button || "查看快捷键"}
          </Button>

          {/* Config Management */}
          <Button
            variant="outline"
            className="w-full"
            onClick={onOpenConfig}
          >
            <Sliders className="h-4 w-4 mr-2" />
            {translations.config?.button || "配置管理"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
