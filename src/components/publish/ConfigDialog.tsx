import {
  Dialog,
} from "@/components/ui/dialog";
import { AppDialogInset } from "@/components/ui/app-dialog-inset";
import { AppDialogShell } from "@/components/ui/app-dialog-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { SectionShell } from "@/components/ui/section-shell";
import {
  Download,
  Upload,
  Save,
  Trash2,
  Loader2,
  AlertCircle,
  Play,
  FileCog,
  Layers3,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import {
  getProfiles,
  saveProfile,
  deleteProfile,
  exportConfig,
  importConfig,
  applyImportedConfig,
  type ConfigProfile,
} from "@/lib/store";
import { useI18n } from "@/hooks/useI18n";

interface ConfigManagementContentProps {
  active: boolean;
  onLoadProfile: (profile: ConfigProfile) => void;
  currentProviderId: string;
  repoId: string | null;
  currentParameters: Record<string, any>;
  closeOnLoad?: boolean;
  onClose?: () => void;
  onProfilesChanged?: () => void | Promise<void>;
}

interface ConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLoadProfile: (profile: ConfigProfile) => void;
  currentProviderId: string;
  repoId: string | null;
  currentParameters: Record<string, any>;
  onProfilesChanged?: () => void | Promise<void>;
}

export function ConfigManagementContent({
  active,
  onLoadProfile,
  currentProviderId,
  repoId,
  currentParameters,
  closeOnLoad = false,
  onClose,
  onProfilesChanged,
}: ConfigManagementContentProps) {
  const { translations, language } = useI18n();
  const profileT = translations.profiles || {};
  const dateLocale = language === "en" ? "en-US" : "zh-CN";
  const [profiles, setProfiles] = useState<ConfigProfile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const notifyProfilesChanged = useCallback(async () => {
    await Promise.resolve(onProfilesChanged?.());
  }, [onProfilesChanged]);

  const loadProfiles = useCallback(async () => {
    if (!repoId) {
      setProfiles([]);
      return;
    }

    setIsLoading(true);
    try {
      const data = await getProfiles(repoId);
      setProfiles(data);
    } catch (err) {
      console.error("加载配置文件失败:", err);
      toast.error(profileT.loadFailed || "加载配置文件失败");
    } finally {
      setIsLoading(false);
    }
  }, [profileT.loadFailed, repoId]);

  useEffect(() => {
    if (!active) {
      return;
    }
    void loadProfiles();
  }, [active, loadProfiles]);

  const handleSaveProfile = async () => {
    if (!repoId) return;
    if (!newProfileName.trim()) {
      toast.error(profileT.enterProfileName || "请输入配置文件名称");
      return;
    }

    setIsSaving(true);
    try {
      await saveProfile({
        repoId,
        name: newProfileName,
        providerId: currentProviderId,
        parameters: currentParameters,
      });
      toast.success(profileT.saveSuccess || "配置文件保存成功");
      setNewProfileName("");
      await loadProfiles();
      await notifyProfilesChanged();
    } catch (err) {
      console.error("保存配置文件失败:", err);
      toast.error(String(err) || profileT.saveFailed || "保存配置文件失败");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteProfile = async (profile: ConfigProfile) => {
    if (!repoId) return;
    if (profile.isSystemDefault) {
      toast.error(profileT.cannotDeleteDefault || "不能删除系统默认配置文件");
      return;
    }

    try {
      await deleteProfile(repoId, profile.name);
      toast.success(profileT.deleteSuccess || "配置文件删除成功");
      await loadProfiles();
      await notifyProfilesChanged();
    } catch (err) {
      console.error("删除配置文件失败:", err);
      toast.error(profileT.deleteFailed || "删除配置文件失败");
    }
  };

  const handleLoadSelectedProfile = (profile: ConfigProfile) => {
    onLoadProfile(profile);
    if (closeOnLoad) {
      onClose?.();
    }
  };

  const handleExportConfig = async () => {
    try {
      const filePath = await openDialog({
        filters: [
          {
            name: "JSON",
            extensions: ["json"],
          },
        ],
        defaultPath: "one-publish-config.json",
      });

      if (filePath) {
        await exportConfig({
          profiles,
          filePath: filePath as string,
        });
        toast.success(profileT.exportSuccess || "配置导出成功");
      }
    } catch (err) {
      console.error("导出配置失败:", err);
      toast.error(profileT.exportFailed || "导出配置失败");
    }
  };

  const handleImportConfig = async () => {
    if (!repoId) return;
    try {
      const filePath = await openDialog({
        filters: [
          {
            name: "JSON",
            extensions: ["json"],
          },
        ],
      });

      if (filePath) {
        setIsLoading(true);
        try {
          const config = await importConfig(filePath as string);

          const confirm = window.confirm(
            (profileT.importConfirm ||
              "即将导入 {{count}} 个配置文件:\n{{profiles}}\n\n确认导入？")
              .replace("{{count}}", String(config.profiles.length))
              .replace(
                "{{profiles}}",
                config.profiles.map((profile) => `- ${profile.name}`).join("\n")
              )
          );

          if (confirm) {
            await applyImportedConfig(repoId, config.profiles);
            toast.success(profileT.importSuccess || "配置导入成功");
            await loadProfiles();
            await notifyProfilesChanged();
          }
        } catch (err) {
          console.error("导入配置失败:", err);
          toast.error(String(err) || profileT.importFailed || "导入配置失败");
        } finally {
          setIsLoading(false);
        }
      }
    } catch (err) {
      console.error("选择文件失败:", err);
    }
  };

  return (
    <div className="space-y-5">
      <SectionShell
        icon={Sparkles}
        title={profileT.managementActionsTitle || "配置文件操作"}
        description={
          profileT.managementActionsDescription ||
          "在当前仓库范围内导出配置备份，或从 JSON 文件批量导入。"
        }
      >
        <div className="grid gap-3 md:grid-cols-2">
          <Button
            variant="outline"
            onClick={handleExportConfig}
            className="h-11 justify-start"
          >
            <Download className="mr-2 h-4 w-4" />
            {profileT.export || "导出配置"}
          </Button>
          <Button
            variant="outline"
            onClick={handleImportConfig}
            className="h-11 justify-start"
            disabled={!repoId}
          >
            <Upload className="mr-2 h-4 w-4" />
            {profileT.import || "导入配置"}
          </Button>
        </div>
      </SectionShell>

      <SectionShell
        icon={Layers3}
        title={profileT.saveCurrent || "保存当前配置"}
        description={
          profileT.managementSaveDescription ||
          "把当前中栏参数快照保存成可复用的发布配置，便于后续直接加载。"
        }
      >
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div className="space-y-2">
            <Label htmlFor="config-profile-name">
              {profileT.profileNamePlaceholder || "输入配置文件名称"}
            </Label>
            <Input
              id="config-profile-name"
              placeholder={profileT.profileNamePlaceholder || "输入配置文件名称"}
              value={newProfileName}
              onChange={(e) => setNewProfileName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !isSaving) {
                  void handleSaveProfile();
                }
              }}
              disabled={!repoId}
              className="h-11"
            />
            <p className="text-xs leading-5 text-muted-foreground">
              {profileT.quickCreateNameHint ||
                "配置名会直接显示在中栏列表里，建议简短清晰。"}
            </p>
          </div>
          <Button
            onClick={() => void handleSaveProfile()}
            disabled={isSaving || !newProfileName.trim() || !repoId}
            className="h-11 min-w-[148px]"
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {profileT.quickCreateSaving || "保存中..."}
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                {profileT.saveCurrentAction || "保存配置"}
              </>
            )}
          </Button>
        </div>
      </SectionShell>

      <SectionShell
        icon={FileCog}
        title={profileT.savedProfiles || "已保存的配置"}
        description={
          profileT.managementSavedDescription ||
          "管理当前仓库已保存的配置，支持直接加载与删除自定义项。"
        }
      >
        {isLoading && profiles.length === 0 ? (
          <AppDialogInset className="flex min-h-[180px] items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </AppDialogInset>
        ) : profiles.length === 0 ? (
          <AppDialogInset className="px-5 py-10 text-center text-muted-foreground">
            <AlertCircle className="mx-auto mb-3 h-8 w-8" />
            <p className="text-sm">{profileT.noProfiles || "暂无保存的配置文件"}</p>
          </AppDialogInset>
        ) : (
          <div className="space-y-3">
            {profiles.map((profile) => (
              <Card key={profile.name} className="rounded-2xl">
                <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <h4 className="truncate text-sm font-semibold text-foreground">
                        {profile.name}
                      </h4>
                      {profile.isSystemDefault ? (
                        <span className="inline-flex items-center rounded-full bg-primary/12 px-2 py-0.5 text-[11px] font-medium text-primary">
                          {profileT.defaultTag || "默认"}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs leading-5 text-muted-foreground">
                      {profile.providerId} ·{" "}
                      {new Date(profile.createdAt).toLocaleDateString(dateLocale)}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button
                      variant="outline"
                      onClick={() => handleLoadSelectedProfile(profile)}
                      className="h-10 min-w-[112px]"
                    >
                      <Play className="mr-2 h-4 w-4" />
                      {profileT.load || "加载"}
                    </Button>
                    {!profile.isSystemDefault ? (
                      <Button
                        variant="ghost"
                        onClick={() => void handleDeleteProfile(profile)}
                        className="h-10 px-3 text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </SectionShell>
    </div>
  );
}

export function ConfigDialog({
  open: isOpen,
  onOpenChange,
  onLoadProfile,
  currentProviderId,
  repoId,
  currentParameters,
  onProfilesChanged,
}: ConfigDialogProps) {
  const { translations } = useI18n();
  const profileT = translations.profiles || {};
  const commonT = translations.common || {};

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <AppDialogShell
        size="workspace"
        title={profileT.title || "配置管理"}
        description={profileT.description || "管理、导入、导出发布配置文件"}
        icon={<FileCog className="h-4 w-4" />}
        bodyInnerClassName="space-y-5"
        footerClassName="sm:space-x-0"
        footer={
          <>
            <div className="text-xs leading-5 text-muted-foreground">
              {profileT.managementFooterHint ||
                "在这里统一导入、导出、保存和加载当前仓库的发布配置。"}
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                {commonT.close || "关闭"}
              </Button>
            </div>
          </>
        }
      >
        <ConfigManagementContent
          active={isOpen}
          onLoadProfile={onLoadProfile}
          currentProviderId={currentProviderId}
          repoId={repoId}
          currentParameters={currentParameters}
          closeOnLoad
          onClose={() => onOpenChange(false)}
          onProfilesChanged={onProfilesChanged}
        />
      </AppDialogShell>
    </Dialog>
  );
}
