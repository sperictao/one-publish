import { Button } from "@/components/ui/button";
import { AppDialogInset } from "@/components/ui/app-dialog-inset";
import { AppDialogShell } from "@/components/ui/app-dialog-shell";
import { Dialog } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { ExecutionRecord } from "@/lib/store";
import { AlertTriangle, GitBranch, ListChecks, TerminalSquare } from "lucide-react";

interface RerunChecklistState {
  branch: boolean;
  environment: boolean;
  output: boolean;
}

interface RerunChecklistDialogProps {
  open: boolean;
  pendingRerunRecord: ExecutionRecord | null;
  selectedRepoCurrentBranch?: string | null;
  environmentStatus: "unknown" | "ready" | "warning" | "blocked";
  rerunChecklistState: RerunChecklistState;
  rerunT: Record<string, string | undefined>;
  onOpenChange: (open: boolean) => void;
  onChecklistStateChange: (state: RerunChecklistState) => void;
  onClose: () => void;
  onConfirm: () => void;
}

export function RerunChecklistDialog({
  open,
  pendingRerunRecord,
  selectedRepoCurrentBranch,
  environmentStatus,
  rerunChecklistState,
  rerunT,
  onOpenChange,
  onChecklistStateChange,
  onClose,
  onConfirm,
}: RerunChecklistDialogProps) {
  const checklistItems = [
    {
      id: "rerun-check-branch",
      label: rerunT.branchCheck || "我已确认当前分支允许重跑",
      checked: rerunChecklistState.branch,
      icon: GitBranch,
      onCheckedChange: (checked: boolean) =>
        onChecklistStateChange({
          ...rerunChecklistState,
          branch: checked,
        }),
    },
    {
      id: "rerun-check-env",
      label: rerunT.environmentCheck || "我已确认环境状态满足预期",
      checked: rerunChecklistState.environment,
      icon: AlertTriangle,
      onCheckedChange: (checked: boolean) =>
        onChecklistStateChange({
          ...rerunChecklistState,
          environment: checked,
        }),
    },
    {
      id: "rerun-check-output",
      label: rerunT.outputCheck || "我已确认输出目标目录与日志窗口",
      checked: rerunChecklistState.output,
      icon: TerminalSquare,
      onCheckedChange: (checked: boolean) =>
        onChecklistStateChange({
          ...rerunChecklistState,
          output: checked,
        }),
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AppDialogShell
        size="compact"
        dialogClassName="sm:max-w-[580px]"
        title={rerunT.title || "重跑前确认清单"}
        description={
          rerunT.description || "请确认以下检查项，避免在敏感分支或错误目标上触发重跑。"
        }
        icon={<ListChecks className="size-4" />}
        bodyInnerClassName="space-y-3"
        footer={
          <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={onClose}>
              {rerunT.cancel || "取消"}
            </Button>
            <Button
              onClick={onConfirm}
              disabled={
                !rerunChecklistState.branch ||
                !rerunChecklistState.environment ||
                !rerunChecklistState.output
              }
            >
              {rerunT.confirm || "确认并重跑"}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <AppDialogInset className="space-y-2 text-sm">
            <div>
              <span className="text-muted-foreground">{rerunT.provider || "Provider:"}</span>{" "}
              {pendingRerunRecord?.providerId || rerunT.unknown || "(未知)"}
            </div>
            <div>
              <span className="text-muted-foreground">{rerunT.currentBranch || "当前分支:"}</span>{" "}
              {selectedRepoCurrentBranch || rerunT.unknown || "(未知)"}
            </div>
            <div>
              <span className="text-muted-foreground">{rerunT.environmentStatus || "环境状态:"}</span>{" "}
              {environmentStatus === "ready"
                ? rerunT.ready || "已就绪"
                : environmentStatus === "warning"
                  ? rerunT.warning || "存在警告"
                  : environmentStatus === "blocked"
                    ? rerunT.blocked || "存在阻断问题"
                    : rerunT.notChecked || "未检查"}
            </div>
            <div>
              <span className="text-muted-foreground">{rerunT.outputTarget || "输出目标:"}</span>{" "}
              {pendingRerunRecord?.outputDir || rerunT.unrecorded || "(未记录)"}
            </div>
          </AppDialogInset>

          <div className="space-y-2">
            {checklistItems.map((item) => {
              const Icon = item.icon;

              return (
                <AppDialogInset
                  key={item.id}
                  className="flex items-center justify-between gap-4 px-4 py-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex size-9 flex-shrink-0 items-center justify-center rounded-xl bg-background/60 text-foreground/75">
                      <Icon className="size-4" />
                    </span>
                    <Label htmlFor={item.id} className="text-sm leading-5">
                      {item.label}
                    </Label>
                  </div>
                  <Switch
                    id={item.id}
                    checked={item.checked}
                    onCheckedChange={item.onCheckedChange}
                  />
                </AppDialogInset>
              );
            })}
          </div>
        </div>
      </AppDialogShell>
    </Dialog>
  );
}
