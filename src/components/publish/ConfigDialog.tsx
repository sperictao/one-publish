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
  importConfig,
} from "@/lib/store/api";
import {
  type ConfigParameters,
  type ConfigProfile,
} from "@/lib/store/types";
import { useI18n } from "@/hooks/useI18n";

interface ConfigManagementContentProps {
  active: boolean;
  profiles: ConfigProfile[];
  isProfilesRefreshing?: boolean;
  onRefreshProfiles: () => void | Promise<ConfigProfile[]>;
  onSaveProfile: (params: {
    name: string;
    providerId: string;
    parameters: ConfigParameters;
  }) => Promise<void>;
  onDeleteProfile: (profile: ConfigProfile) => Promise<void>;
  onExportProfiles: (filePath: string) => Promise<void>;
  onApplyImportedProfiles: (profiles: ConfigProfile[]) => Promise<void>;
  onLoadProfile: (profile: ConfigProfile) => void;
  currentProviderId: string;
  repoId: string | null;
  currentParameters: ConfigParameters;
  closeOnLoad?: boolean;
  onClose?: () => void;
}

interface PendingImportState {
  profiles: ConfigProfile[];
}

interface ConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profiles: ConfigProfile[];
  isProfilesRefreshing?: boolean;
  onRefreshProfiles: () => void | Promise<ConfigProfile[]>;
  onSaveProfile: (params: {
    name: string;
    providerId: string;
    parameters: ConfigParameters;
  }) => Promise<void>;
  onDeleteProfile: (profile: ConfigProfile) => Promise<void>;
  onExportProfiles: (filePath: string) => Promise<void>;
  onApplyImportedProfiles: (profiles: ConfigProfile[]) => Promise<void>;
  onLoadProfile: (profile: ConfigProfile) => void;
  currentProviderId: string;
  repoId: string | null;
  currentParameters: ConfigParameters;
}

export function ConfigManagementContent({
  active,
  profiles,
  isProfilesRefreshing = false,
  onRefreshProfiles,
  onSaveProfile,
  onDeleteProfile,
  onExportProfiles,
  onApplyImportedProfiles,
  onLoadProfile,
  currentProviderId,
  repoId,
  currentParameters,
  closeOnLoad = false,
  onClose,
}: ConfigManagementContentProps) {
  const { translations, language } = useI18n();
  const profileT = translations.profiles || {};
  const dateLocale = language === "en" ? "en-US" : "zh-CN";
  const [newProfileName, setNewProfileName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [pendingImport, setPendingImport] = useState<PendingImportState | null>(null);
  const [isImportLoading, setIsImportLoading] = useState(false);
  const [isApplyingImport, setIsApplyingImport] = useState(false);
  const isLoading = isProfilesRefreshing || isImportLoading;

  useEffect(() => {
    if (!active) {
      return;
    }
    void onRefreshProfiles();
  }, [active, onRefreshProfiles]);

  const handleSaveProfile = async () => {
    if (!repoId) return;
    if (!newProfileName.trim()) {
      toast.error(profileT.enterProfileName || "请输入配置文件名称");
      return;
    }

    setIsSaving(true);
    try {
      await onSaveProfile({
        name: newProfileName,
        providerId: currentProviderId,
        parameters: currentParameters,
      });
      toast.success(profileT.saveSuccess || "配置文件保存成功");
      setNewProfileName("");
    } catch (err) {
      toast.error(profileT.saveFailed || "保存配置文件失败", {
        description: err instanceof Error ? err.message : String(err),
      });
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
      await onDeleteProfile(profile);
      toast.success(profileT.deleteSuccess || "配置文件删除成功");
    } catch (err) {
      toast.error(profileT.deleteFailed || "删除配置文件失败", {
        description: err instanceof Error ? err.message : String(err),
      });
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
        await onExportProfiles(filePath as string);
        toast.success(profileT.exportSuccess || "配置导出成功");
      }
    } catch (err) {
      toast.error(profileT.exportFailed || "导出配置失败", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const closeImportPreview = useCallback(() => {
    if (isApplyingImport) {
      return;
    }
    setPendingImport(null);
  }, [isApplyingImport]);

  const confirmImportConfig = useCallback(async () => {
    if (!repoId || !pendingImport) {
      return;
    }

    setIsApplyingImport(true);
    try {
      await onApplyImportedProfiles(pendingImport.profiles);
      toast.success(profileT.importSuccess || "配置导入成功");
      setPendingImport(null);
    } catch (err) {
      toast.error(profileT.importFailed || "导入配置失败", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsApplyingImport(false);
    }
  }, [
    onApplyImportedProfiles,
    pendingImport,
    profileT.importFailed,
    profileT.importSuccess,
    repoId,
  ]);

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
        setIsImportLoading(true);
        try {
          const config = await importConfig(filePath as string);
          setPendingImport({
            profiles: config.profiles,
          });
        } catch (err) {
          toast.error(profileT.importFailed || "导入配置失败", {
            description: err instanceof Error ? err.message : String(err),
          });
        } finally {
          setIsImportLoading(false);
        }
      }
    } catch (err) {
      toast.error(profileT.importFailed || "导入配置失败", {
        description: err instanceof Error ? err.message : String(err),
      });
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
            <Download className="mr-2 size-4" />
            {profileT.export || "导出配置"}
          </Button>
          <Button
            variant="outline"
            onClick={handleImportConfig}
            className="h-11 justify-start"
            disabled={!repoId}
          >
            <Upload className="mr-2 size-4" />
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
            <p className="text-label-12 text-muted-foreground">
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
                <span className="inline-block animate-spin mr-2">
                  <Loader2 className="size-4" />
                </span>
                {profileT.quickCreateSaving || "保存中..."}
              </>
            ) : (
              <>
                <Save className="mr-2 size-4" />
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
            <span className="inline-block animate-spin text-muted-foreground">
              <Loader2 className="size-6" />
            </span>
          </AppDialogInset>
        ) : profiles.length === 0 ? (
          <AppDialogInset className="px-5 py-10 text-center text-muted-foreground">
            <AlertCircle className="mx-auto mb-3 size-8" />
            <p className="text-label-14">{profileT.noProfiles || "暂无保存的配置文件"}</p>
          </AppDialogInset>
        ) : (
          <div className="space-y-3">
            {profiles.map((profile) => (
              <Card key={profile.name} className="rounded-lg">
                <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <h4 className="truncate text-label-14 font-semibold text-foreground">
                        {profile.name}
                      </h4>
                      {profile.isSystemDefault ? (
                        <span className="inline-flex items-center rounded-full bg-interactive/10 px-2 py-0.5 text-label-12 font-semibold text-interactive">
                          {profileT.defaultTag || "默认"}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-label-12 text-muted-foreground">
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
                      <Play className="mr-2 size-4" />
                      {profileT.load || "加载"}
                    </Button>
                    {!profile.isSystemDefault ? (
                      <Button
                        variant="ghost"
                        onClick={() => void handleDeleteProfile(profile)}
                        aria-label={`${profileT.deleteProfileAction || "删除配置"}${profile.name ? `: ${profile.name}` : ""}`}
                        className="h-10 px-3 text-destructive hover:text-destructive"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </SectionShell>

      <Dialog open={Boolean(pendingImport)} onOpenChange={(open) => {
        if (!open) {
          closeImportPreview();
        }
      }}>
        {pendingImport ? (
          <AppDialogShell
            size="compact"
            title={profileT.importConfirmTitle || "确认导入配置"}
            description={
              (profileT.importConfirmDescription ||
                "将把以下 {{count}} 个配置导入当前仓库，并按现有规则进行合并或覆盖。")
                .replace("{{count}}", String(pendingImport.profiles.length))
            }
            icon={<Upload className="size-4" />}
            bodyInnerClassName="space-y-4"
            footer={
              <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeImportPreview}
                  disabled={isApplyingImport}
                >
                  {translations.common?.cancel || "取消"}
                </Button>
                <Button
                  type="button"
                  onClick={() => void confirmImportConfig()}
                  disabled={isApplyingImport}
                >
                  {isApplyingImport ? (
                    <>
                      <span className="inline-block animate-spin mr-2">
                        <Loader2 className="size-4" />
                      </span>
                      {profileT.importing || "导入中..."}
                    </>
                  ) : (
                    profileT.confirmImportAction || "确认导入"
                  )}
                </Button>
              </div>
            }
          >
            <AppDialogInset className="space-y-3">
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 size-4 text-warning" />
                <div className="space-y-1 text-copy-14">
                  <p className="font-normal">
                    {profileT.importConfirmListTitle || "待导入配置"}
                  </p>
                  <p className="text-muted-foreground">
                    {profileT.importConfirmHint ||
                      "导入后会立即刷新当前仓库的配置列表。"}
                  </p>
                </div>
              </div>
              <div className="rounded-md border border-border bg-muted p-3">
                <ul className="max-h-52 space-y-2 overflow-y-auto text-copy-14">
                  {pendingImport.profiles.map((profile) => (
                    <li
                      key={`${profile.providerId}:${profile.name}`}
                      className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5"
                    >
                      <span className="truncate font-semibold text-foreground">
                        {profile.name}
                      </span>
                      <span className="flex-shrink-0 text-label-12 text-muted-foreground">
                        {profile.providerId}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </AppDialogInset>
          </AppDialogShell>
        ) : null}
      </Dialog>
    </div>
  );
}

export function ConfigDialog({
  open: isOpen,
  onOpenChange,
  profiles,
  isProfilesRefreshing,
  onRefreshProfiles,
  onSaveProfile,
  onDeleteProfile,
  onExportProfiles,
  onApplyImportedProfiles,
  onLoadProfile,
  currentProviderId,
  repoId,
  currentParameters,
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
        icon={<FileCog className="size-4" />}
        bodyInnerClassName="space-y-5"
        footerClassName="sm:space-x-0"
        footer={
          <>
            <div className="text-label-12 text-muted-foreground">
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
          profiles={profiles}
          isProfilesRefreshing={isProfilesRefreshing}
          onRefreshProfiles={onRefreshProfiles}
          onSaveProfile={onSaveProfile}
          onDeleteProfile={onDeleteProfile}
          onExportProfiles={onExportProfiles}
          onApplyImportedProfiles={onApplyImportedProfiles}
          onLoadProfile={onLoadProfile}
          currentProviderId={currentProviderId}
          repoId={repoId}
          currentParameters={currentParameters}
          closeOnLoad
          onClose={() => onOpenChange(false)}
        />
      </AppDialogShell>
    </Dialog>
  );
}
