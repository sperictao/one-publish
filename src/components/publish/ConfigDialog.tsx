import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  Download,
  Upload,
  Save,
  Trash2,
  Loader2,
  AlertCircle,
  Play,
} from "lucide-react";
import { useState, useEffect } from "react";
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

interface ConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLoadProfile: (profile: ConfigProfile) => void;
  currentProviderId: string;
  repoId: string | null;
  currentParameters: Record<string, any>;
}

export function ConfigDialog({
  open: isOpen,
  onOpenChange,
  onLoadProfile,
  currentProviderId,
  repoId,
  currentParameters,
}: ConfigDialogProps) {
  const { translations, language } = useI18n();
  const profileT = translations.profiles || {};
  const dateLocale = language === "en" ? "en-US" : "zh-CN";
  const [profiles, setProfiles] = useState<ConfigProfile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // 加载配置文件列表
  const loadProfiles = async () => {
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
  };

  // 对话框打开时加载配置文件
  useEffect(() => {
    if (isOpen) {
      loadProfiles();
    }
  }, [isOpen, repoId]);

  // 保存当前配置为新配置文件
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
    } catch (err: any) {
      console.error("保存配置文件失败:", err);
      toast.error(err || profileT.saveFailed || "保存配置文件失败");
    } finally {
      setIsSaving(false);
    }
  };

  // 删除配置文件
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
    } catch (err) {
      console.error("删除配置文件失败:", err);
      toast.error(profileT.deleteFailed || "删除配置文件失败");
    }
  };

  // 加载配置文件
  const handleLoadProfile = async (profile: ConfigProfile) => {
    onLoadProfile(profile);
    onOpenChange(false);
  };

  // 导出配置
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

  // 导入配置
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

          // 显示导入预览
          const confirm = window.confirm(
            (profileT.importConfirm ||
              "即将导入 {{count}} 个配置文件:\n{{profiles}}\n\n确认导入？")
              .replace("{{count}}", String(config.profiles.length))
              .replace(
                "{{profiles}}",
                config.profiles.map((p) => `- ${p.name}`).join("\n")
              )
          );

          if (confirm) {
            await applyImportedConfig(repoId, config.profiles);
            toast.success(profileT.importSuccess || "配置导入成功");
            await loadProfiles();
          }
        } catch (err: any) {
          console.error("导入配置失败:", err);
          toast.error(err || profileT.importFailed || "导入配置失败");
        } finally {
          setIsLoading(false);
        }
      }
    } catch (err) {
      console.error("选择文件失败:", err);
    }
  };


  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{profileT.title || "配置管理"}</DialogTitle>
          <DialogDescription>
            {profileT.description || "管理、导入、导出发布配置文件"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto">
          {/* 操作按钮 */}
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleExportConfig} className="flex-1">
              <Download className="h-4 w-4 mr-2" />
              {profileT.export || "导出配置"}
            </Button>
            <Button variant="outline" onClick={handleImportConfig} className="flex-1" disabled={!repoId}>
              <Upload className="h-4 w-4 mr-2" />
              {profileT.import || "导入配置"}
            </Button>
          </div>

          {/* 保存当前配置 */}
          <div className="space-y-2">
            <Label>{profileT.saveCurrent || "保存当前配置"}</Label>
            <div className="flex gap-2">
              <Input
                placeholder={profileT.profileNamePlaceholder || "输入配置文件名称"}
                value={newProfileName}
                onChange={(e) => setNewProfileName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !isSaving) {
                    handleSaveProfile();
                  }
                }}
                disabled={!repoId}
              />
              <Button onClick={handleSaveProfile} disabled={isSaving || !newProfileName.trim() || !repoId}>
                {isSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          {/* 配置文件列表 */}
          <div className="space-y-2">
            <Label>{profileT.savedProfiles || "已保存的配置"}</Label>
            {isLoading && profiles.length === 0 ? (
              <div className="flex items-center justify-center p-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : profiles.length === 0 ? (
              <div className="text-center p-8 text-muted-foreground glass-surface rounded-2xl">
                <AlertCircle className="h-8 w-8 mx-auto mb-2" />
                <p>{profileT.noProfiles || "暂无保存的配置文件"}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {profiles.map((profile) => (
                  <Card key={profile.name}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-medium">{profile.name}</h4>
                            {profile.isSystemDefault && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-primary text-primary-foreground">
                                {profileT.defaultTag || "默认"}
                              </span>
                            )}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {profile.providerId} · {new Date(profile.createdAt).toLocaleDateString(dateLocale)}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleLoadProfile(profile)}
                          >
                            <Play className="h-4 w-4 mr-1" />
                            {profileT.load || "加载"}
                          </Button>
                          {!profile.isSystemDefault && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteProfile(profile)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
