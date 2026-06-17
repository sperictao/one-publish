import { useEffect, useMemo, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  ListChecks,
  Loader2,
  ShieldCheck,
  XCircle,
} from "lucide-react";

import { AppDialogBadge } from "@/components/ui/app-dialog-badge";
import { AppDialogInset } from "@/components/ui/app-dialog-inset";
import { AppDialogShell } from "@/components/ui/app-dialog-shell";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/hooks/useI18n";
import { joinPath } from "@/lib/paths";
import type { PackageResult, SignResult } from "@/lib/artifact";
import type { EnvironmentCheckResult } from "@/features/environment/environment";
import { getUpdaterConfigHealth } from "@/lib/store/api";
import { type UpdaterConfigHealth } from "@/lib/store/types";
import {
  exportPreflightReport,
  type PreflightChecklistItem,
  type PreflightReportPayload,
} from "@/lib/preflight";

type ChecklistStatus = "pass" | "warning" | "fail" | "pending";

interface PublishSummary {
  success: boolean;
  output_dir: string;
  file_count: number;
  error: string | null;
}

interface ChecklistItem {
  id: string;
  title: string;
  description: string;
  status: ChecklistStatus;
  detail: string;
  actionLabel?: string;
  onAction?: () => void;
}

export interface ReleaseChecklistDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  publishResult: PublishSummary | null;
  environmentResult: EnvironmentCheckResult | null;
  packageResult: PackageResult | null;
  signResult: SignResult | null;
  onOpenEnvironment?: () => void;
  onOpenSettings?: () => void;
}

function statusStyles(status: ChecklistStatus) {
  if (status === "pass") {
    return {
      icon: <CheckCircle2 className="size-4 text-success" />,
      badgeVariant: "success" as const,
    };
  }
  if (status === "warning") {
    return {
      icon: <AlertTriangle className="size-4 text-warning" />,
      badgeVariant: "warning" as const,
    };
  }
  if (status === "fail") {
    return {
      icon: <XCircle className="size-4 text-destructive" />,
      badgeVariant: "danger" as const,
    };
  }
  return {
    icon: <Circle className="size-4 text-muted-foreground" />,
    badgeVariant: "neutral" as const,
  };
}

function buildDefaultReportPath(outputDir: string | undefined) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `preflight-report-${stamp}.md`;
  if (!outputDir) return fileName;
  return joinPath(outputDir, fileName);
}

export function ReleaseChecklistDialog({
  open,
  onOpenChange,
  publishResult,
  environmentResult,
  packageResult,
  signResult,
  onOpenEnvironment,
  onOpenSettings,
}: ReleaseChecklistDialogProps) {
  const { translations } = useI18n();
  const [updaterHealth, setUpdaterHealth] = useState<UpdaterConfigHealth | null>(null);
  const [updaterLoading, setUpdaterLoading] = useState(false);
  const [updaterError, setUpdaterError] = useState<string | null>(null);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [exporting, setExporting] = useState(false);
  const prevOpenRef = useRef(open);

  const checklistTranslations = translations.releaseChecklist || {};

  if (prevOpenRef.current !== open) {
    prevOpenRef.current = open;
    if (open) {
      setUpdaterLoading(true);
      setUpdaterError(null);
      setUpdaterHealth(null);
    }
  }

  useEffect(() => {
    if (!open) return;

    getUpdaterConfigHealth()
      .then((health) => {
        setUpdaterHealth(health);
      })
      .catch((err) => {
        setUpdaterError(String(err));
      })
      .finally(() => {
        setUpdaterLoading(false);
      });
  }, [open]);

  const checklistItems = useMemo<ChecklistItem[]>(() => {
    const criticalIssues = environmentResult
      ? environmentResult.issues.filter((i) => i.severity === "critical").length
      : 0;
    const warningIssues = environmentResult
      ? environmentResult.issues.filter((i) => i.severity === "warning").length
      : 0;

    const environmentStatus: ChecklistStatus = !environmentResult
      ? "pending"
      : criticalIssues > 0
        ? "fail"
        : warningIssues > 0
          ? "warning"
          : "pass";

    const publishStatus: ChecklistStatus = !publishResult
      ? "pending"
      : publishResult.success
        ? "pass"
        : "fail";

    const packageStatus: ChecklistStatus = packageResult
      ? "pass"
      : "pending";

    const signStatus: ChecklistStatus = signResult
      ? signResult.success
        ? "pass"
        : "fail"
      : "pending";

    let updaterStatus: ChecklistStatus = "pending";
    if (updaterLoading) {
      updaterStatus = "pending";
    } else if (updaterError) {
      updaterStatus = "warning";
    } else if (updaterHealth) {
      updaterStatus = updaterHealth.configured ? "pass" : "warning";
    }

    return [
      {
        id: "environment",
        title:
          checklistTranslations.steps?.environment?.title || "环境检查",
        description:
          checklistTranslations.steps?.environment?.description ||
          "确认发布机器不存在阻断问题",
        status: environmentStatus,
        detail: !environmentResult
          ? checklistTranslations.steps?.environment?.pendingDetail ||
            "还没有环境检查结果，建议先执行一次环境检查。"
          : `${environmentResult.checked_at} · ${criticalIssues} 阻断 / ${warningIssues} 警告`,
        actionLabel:
          checklistTranslations.actions?.openEnvironment || "打开环境检查",
        onAction: onOpenEnvironment,
      },
      {
        id: "publish",
        title: checklistTranslations.steps?.publish?.title || "发布结果",
        description:
          checklistTranslations.steps?.publish?.description ||
          "确认发布命令执行成功并产出目标目录",
        status: publishStatus,
        detail: !publishResult
          ? checklistTranslations.steps?.publish?.pendingDetail ||
            "尚未执行发布。"
          : publishResult.success
            ? `${publishResult.output_dir} (${publishResult.file_count} files)`
            : publishResult.error ||
              checklistTranslations.steps?.publish?.failedDetail ||
              "发布失败，请先修复后重试。",
      },
      {
        id: "package",
        title: checklistTranslations.steps?.package?.title || "产物打包",
        description:
          checklistTranslations.steps?.package?.description ||
          "将发布目录打包为可分发的 ZIP 产物",
        status: packageStatus,
        detail: packageResult
          ? `${packageResult.artifactPath}\nsha256: ${packageResult.sha256}`
          : publishResult?.success
            ? checklistTranslations.steps?.package?.pendingDetail ||
              "请在输出日志卡片点击“打包 ZIP”。"
            : checklistTranslations.steps?.package?.blockedDetail ||
              "需先完成发布。",
      },
      {
        id: "sign",
        title: checklistTranslations.steps?.sign?.title || "签名校验",
        description:
          checklistTranslations.steps?.sign?.description ||
          "为产物生成 detached signature",
        status: signStatus,
        detail: signResult
          ? signResult.success
            ? signResult.signaturePath
            : signResult.stderr ||
              `exitCode: ${signResult.exitCode}`
          : packageResult
            ? checklistTranslations.steps?.sign?.pendingDetail ||
              "请在输出日志卡片点击“签名 (GPG)”。"
            : checklistTranslations.steps?.sign?.blockedDetail ||
              "需先完成打包。",
      },
      {
        id: "updater",
        title: checklistTranslations.steps?.updater?.title || "Updater 配置",
        description:
          checklistTranslations.steps?.updater?.description ||
          "确认应用更新通道配置可用",
        status: updaterStatus,
        detail: updaterLoading
          ? checklistTranslations.steps?.updater?.loadingDetail ||
            "正在检测 updater 配置..."
          : updaterError
            ? updaterError
            : updaterHealth?.message ||
              checklistTranslations.steps?.updater?.pendingDetail ||
              "尚未获取 updater 状态。",
        actionLabel:
          checklistTranslations.actions?.openSettings || "打开设置",
        onAction: onOpenSettings,
      },
    ];
  }, [
    checklistTranslations.actions?.openEnvironment,
    checklistTranslations.actions?.openSettings,
    checklistTranslations.steps?.environment?.description,
    checklistTranslations.steps?.environment?.pendingDetail,
    checklistTranslations.steps?.environment?.title,
    checklistTranslations.steps?.package?.blockedDetail,
    checklistTranslations.steps?.package?.description,
    checklistTranslations.steps?.package?.pendingDetail,
    checklistTranslations.steps?.package?.title,
    checklistTranslations.steps?.publish?.description,
    checklistTranslations.steps?.publish?.failedDetail,
    checklistTranslations.steps?.publish?.pendingDetail,
    checklistTranslations.steps?.publish?.title,
    checklistTranslations.steps?.sign?.blockedDetail,
    checklistTranslations.steps?.sign?.description,
    checklistTranslations.steps?.sign?.pendingDetail,
    checklistTranslations.steps?.sign?.title,
    checklistTranslations.steps?.updater?.description,
    checklistTranslations.steps?.updater?.loadingDetail,
    checklistTranslations.steps?.updater?.pendingDetail,
    checklistTranslations.steps?.updater?.title,
    environmentResult,
    onOpenEnvironment,
    onOpenSettings,
    packageResult,
    publishResult,
    signResult,
    updaterError,
    updaterHealth,
    updaterLoading,
  ]);

  const firstIncompleteStep = useMemo(() => {
    const index = checklistItems.findIndex((item) => item.status !== "pass");
    return index >= 0 ? index : 0;
  }, [checklistItems]);

  useEffect(() => {
    if (!open) return;
    setActiveStepIndex(firstIncompleteStep);
  }, [firstIncompleteStep, open]);

  const activeStep = checklistItems[activeStepIndex] || checklistItems[0];
  const passedCount = checklistItems.filter((item) => item.status === "pass").length;
  const warningCount = checklistItems.filter((item) => item.status === "warning").length;
  const failedCount = checklistItems.filter((item) => item.status === "fail").length;

  const blockingReady =
    checklistItems.find((item) => item.id === "environment")?.status === "pass" &&
    checklistItems.find((item) => item.id === "publish")?.status === "pass" &&
    checklistItems.find((item) => item.id === "package")?.status === "pass" &&
    checklistItems.find((item) => item.id === "sign")?.status === "pass";

  const readyMessage = blockingReady
    ? checklistTranslations.ready || "签名发布条件已满足"
    : checklistTranslations.notReady || "签名发布条件未满足";

  const reportChecklist = useMemo<PreflightChecklistItem[]>(
    () =>
      checklistItems.map((item) => ({
        id: item.id,
        title: item.title,
        description: item.description,
        status: item.status,
        detail: item.detail,
      })),
    [checklistItems]
  );

  const handleExportReport = async () => {
    const selected = await save({
      title:
        checklistTranslations.exportDialogTitle ||
        "导出预检报告",
      defaultPath: buildDefaultReportPath(publishResult?.output_dir),
      filters: [
        { name: "Markdown", extensions: ["md"] },
        { name: "JSON", extensions: ["json"] },
      ],
    });

    if (!selected) return;

    const report: PreflightReportPayload = {
      generatedAt: new Date().toISOString(),
      summary: {
        passed: passedCount,
        warning: warningCount,
        failed: failedCount,
        blockingReady,
      },
      publishResult: publishResult
        ? {
            success: publishResult.success,
            outputDir: publishResult.output_dir,
            fileCount: publishResult.file_count,
            error: publishResult.error,
          }
        : null,
      environmentResult,
      artifact: {
        packageResult,
        signResult,
      },
      updater: {
        health: updaterHealth,
        error: updaterError,
      },
      checklist: reportChecklist,
    };

    setExporting(true);
    try {
      const outputPath = await exportPreflightReport({
        filePath: selected,
        report,
      });
      toast.success(
        checklistTranslations.exportSuccess || "预检报告已导出",
        { description: outputPath }
      );
    } catch (err) {
      toast.error(
        checklistTranslations.exportFailed || "导出预检报告失败",
        { description: String(err) }
      );
    } finally {
      setExporting(false);
    }
  };

  if (!activeStep) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AppDialogShell
        size="wide"
        title={checklistTranslations.title || "签名发布清单"}
        description={
          checklistTranslations.description ||
          "按步骤核对发布条件，确保产物可分发且可验证。"
        }
        icon={<ListChecks className="size-4" />}
        bodyInnerClassName="space-y-4"
        footerClassName="sm:space-x-0"
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={handleExportReport}
              disabled={exporting}
            >
              {exporting ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  {checklistTranslations.exporting || "导出中..."}
                </>
              ) : (
                checklistTranslations.export || "导出预检报告"
              )}
            </Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
              <Button
                type="button"
                variant="outline"
                onClick={() => setActiveStepIndex((prev) => Math.max(prev - 1, 0))}
                disabled={activeStepIndex === 0 || exporting}
              >
                {checklistTranslations.prev || "上一步"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setActiveStepIndex((prev) =>
                    Math.min(prev + 1, checklistItems.length - 1)
                  )
                }
                disabled={activeStepIndex >= checklistItems.length - 1 || exporting}
              >
                {checklistTranslations.next || "下一步"}
              </Button>
              <Button type="button" onClick={() => onOpenChange(false)} disabled={exporting}>
                {checklistTranslations.close || "完成"}
              </Button>
            </div>
          </>
        }
      >
        <AppDialogInset className="flex flex-wrap gap-2 p-3 text-xs sm:text-sm">
          <AppDialogBadge
            variant="success"
            icon={<CheckCircle2 className="size-3.5" />}
          >
            {(checklistTranslations.summary?.passed || "已通过") + `: ${passedCount}`}
          </AppDialogBadge>
          <AppDialogBadge
            variant="warning"
            icon={<AlertTriangle className="size-3.5" />}
          >
            {(checklistTranslations.summary?.warning || "警告") + `: ${warningCount}`}
          </AppDialogBadge>
          <AppDialogBadge
            variant="danger"
            icon={<XCircle className="size-3.5" />}
          >
            {(checklistTranslations.summary?.failed || "失败") + `: ${failedCount}`}
          </AppDialogBadge>
          <AppDialogBadge
            variant={blockingReady ? "success" : "warning"}
            icon={
              blockingReady ? (
                <ShieldCheck className="size-3.5" />
              ) : (
                <AlertTriangle className="size-3.5" />
              )
            }
          >
            {readyMessage}
          </AppDialogBadge>
        </AppDialogInset>

        <div className="grid gap-4 md:grid-cols-[240px_1fr] overflow-y-auto glass-scrollbar pr-1">
          <div className="space-y-2 glass-stagger">
            {checklistItems.map((item, index) => {
              const style = statusStyles(item.status);
              const statusLabel =
                checklistTranslations.status?.[item.status] || item.status;
              return (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => setActiveStepIndex(index)}
                  className={`glass-press w-full text-left rounded-xl border p-3 glass-transition ${
                    index === activeStepIndex
                      ? "border-primary bg-primary/5 glass-surface-selected"
                      : "border-input hover:bg-muted"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{item.title}</span>
                    {style.icon}
                  </div>
                  <div className="mt-2">
                    <AppDialogBadge variant={style.badgeVariant}>
                      {statusLabel}
                    </AppDialogBadge>
                  </div>
                </button>
              );
            })}
          </div>

          <AppDialogInset className="space-y-4">
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-base font-semibold">{activeStep.title}</h3>
                <span className="text-xs text-muted-foreground">
                  {`${activeStepIndex + 1}/${checklistItems.length}`}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">{activeStep.description}</p>
            </div>

            <div className="rounded-xl border border-input bg-muted p-3 text-xs font-mono whitespace-pre-wrap break-all">
              {activeStep.detail}
            </div>

            {activeStep.actionLabel && activeStep.onAction && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={activeStep.onAction}
              >
                {activeStep.actionLabel}
              </Button>
            )}
          </AppDialogInset>
        </div>
      </AppDialogShell>
    </Dialog>
  );
}
