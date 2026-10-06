import { useState } from "react";
import { AlertCircle, Loader2, Trash2 } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { AppDialogInset } from "@/components/ui/app-dialog-inset";
import { AppDialogShell } from "@/components/ui/app-dialog-shell";
import { Button } from "@/components/ui/button";
import { type ConfigProfile } from "@/lib/store/types";
import { useI18n } from "@/hooks/useI18n";

interface DeleteProfileConfirmDialogProps {
  /** 待删除的配置；为 null 时对话框关闭 */
  profile: ConfigProfile | null;
  onClose: () => void;
  onConfirm: (profile: ConfigProfile) => void | Promise<void>;
}

/**
 * 删除配置前的应用内确认（沿用导入确认的对话框形态）。
 * 删除为不可撤销操作，中栏菜单与配置管理弹窗共用此入口。
 */
export function DeleteProfileConfirmDialog({
  profile,
  onClose,
  onConfirm,
}: DeleteProfileConfirmDialogProps) {
  const { translations } = useI18n();
  const profileT = translations.profiles || {};
  const commonT = translations.common || {};
  const [isDeleting, setIsDeleting] = useState(false);

  const handleConfirm = async (target: ConfigProfile) => {
    setIsDeleting(true);
    try {
      await onConfirm(target);
    } finally {
      setIsDeleting(false);
      onClose();
    }
  };

  return (
    <Dialog
      open={Boolean(profile)}
      onOpenChange={(open) => {
        if (!open && !isDeleting) {
          onClose();
        }
      }}
    >
      {profile ? (
        <AppDialogShell
          size="compact"
          surfaceClassName="min-h-0"
          title={profileT.deleteConfirmTitle || "删除配置"}
          description={(
            profileT.deleteConfirmDescription || "确定删除配置「{{name}}」？"
          ).replace("{{name}}", profile.name)}
          icon={<Trash2 className="size-4" />}
          iconWrapperClassName="bg-destructive/10 text-destructive"
          footer={
            <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={isDeleting}
              >
                {commonT.cancel || "取消"}
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => void handleConfirm(profile)}
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <>
                    <span className="inline-block animate-spin mr-2">
                      <Loader2 className="size-4" />
                    </span>
                    {profileT.deleting || "删除中…"}
                  </>
                ) : (
                  profileT.confirmDeleteAction || "删除"
                )}
              </Button>
            </div>
          }
        >
          <AppDialogInset className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 size-4 flex-shrink-0 text-warning" />
            <p className="text-copy-14 text-muted-foreground">
              {profileT.deleteConfirmHint ||
                "删除后无法在应用内恢复。如需保留，请先在配置管理中导出备份。"}
            </p>
          </AppDialogInset>
        </AppDialogShell>
      ) : null}
    </Dialog>
  );
}
