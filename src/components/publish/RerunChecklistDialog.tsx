import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { ExecutionRecord } from "@/lib/store";

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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{rerunT.title || "重跑前确认清单"}</DialogTitle>
          <DialogDescription>
            {rerunT.description || "请确认以下检查项，避免在敏感分支或错误目标上触发重跑。"}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1 rounded-xl border border-[var(--glass-border-subtle)] bg-[var(--glass-input-bg)] p-3 text-sm">
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
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-xl border border-[var(--glass-border-subtle)] px-3 py-2">
              <Label htmlFor="rerun-check-branch" className="text-sm">
                {rerunT.branchCheck || "我已确认当前分支允许重跑"}
              </Label>
              <Switch
                id="rerun-check-branch"
                checked={rerunChecklistState.branch}
                onCheckedChange={(checked) =>
                  onChecklistStateChange({
                    ...rerunChecklistState,
                    branch: checked,
                  })
                }
              />
            </div>
            <div className="flex items-center justify-between rounded-xl border border-[var(--glass-border-subtle)] px-3 py-2">
              <Label htmlFor="rerun-check-env" className="text-sm">
                {rerunT.environmentCheck || "我已确认环境状态满足预期"}
              </Label>
              <Switch
                id="rerun-check-env"
                checked={rerunChecklistState.environment}
                onCheckedChange={(checked) =>
                  onChecklistStateChange({
                    ...rerunChecklistState,
                    environment: checked,
                  })
                }
              />
            </div>
            <div className="flex items-center justify-between rounded-xl border border-[var(--glass-border-subtle)] px-3 py-2">
              <Label htmlFor="rerun-check-output" className="text-sm">
                {rerunT.outputCheck || "我已确认输出目标目录与日志窗口"}
              </Label>
              <Switch
                id="rerun-check-output"
                checked={rerunChecklistState.output}
                onCheckedChange={(checked) =>
                  onChecklistStateChange({
                    ...rerunChecklistState,
                    output: checked,
                  })
                }
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
