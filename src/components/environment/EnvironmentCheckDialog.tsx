import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  Terminal,
  XCircle,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

import {
  applyFix,
  runEnvironmentCheck,
  type EnvironmentCheckResult,
  type EnvironmentIssue,
  type FixAction,
  type FixResult,
  type IssueSeverity,
} from "@/lib/environment";
import { useI18n } from "@/hooks/useI18n";

const ALL_PROVIDERS: Array<{ id: string; label: string; description: string }> =
  [
    { id: "dotnet", label: ".NET", description: "dotnet SDK" },
    { id: "cargo", label: "Rust", description: "cargo" },
    { id: "go", label: "Go", description: "go" },
    { id: "java", label: "Java", description: "java/javac" },
  ];

function uniqSorted(ids: string[]) {
  return Array.from(new Set(ids.map((x) => x.trim()).filter(Boolean))).sort();
}

function severityRank(sev: IssueSeverity) {
  if (sev === "critical") return 0;
  if (sev === "warning") return 1;
  return 2;
}

function issueSort(a: EnvironmentIssue, b: EnvironmentIssue) {
  const r = severityRank(a.severity) - severityRank(b.severity);
  if (r !== 0) return r;
  return a.description.localeCompare(b.description);
}

function formatFixResult(result: FixResult | null) {
  if (!result) return null;
  if (result.result === "CommandExecuted") {
    const { stdout, stderr, exit_code } = result.data;
    return [
      `exitCode: ${exit_code}`,
      stdout ? `\n[stdout]\n${stdout}` : "",
      stderr ? `\n[stderr]\n${stderr}` : "",
    ]
      .filter(Boolean)
      .join("");
  }
  if (result.result === "OpenedUrl") return `Opened URL: ${result.data}`;
  if (result.result === "CopiedToClipboard") return `Copied: ${result.data}`;
  if (result.result === "Manual") return result.data;
  return JSON.stringify(result, null, 2);
}

export interface EnvironmentCheckDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultProviderIds?: string[];
  initialResult?: EnvironmentCheckResult | null;
  onChecked?: (result: EnvironmentCheckResult) => void;
}

export function EnvironmentCheckDialog({
  open,
  onOpenChange,
  defaultProviderIds = ["dotnet"],
  initialResult = null,
  onChecked,
}: EnvironmentCheckDialogProps) {
  const { translations } = useI18n();

  const [selectedProviderIds, setSelectedProviderIds] = useState<string[]>(
    uniqSorted(defaultProviderIds)
  );
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<EnvironmentCheckResult | null>(initialResult);
  const [error, setError] = useState<string | null>(null);

  const [pendingRun, setPendingRun] = useState<FixAction | null>(null);
  const [runningFix, setRunningFix] = useState(false);
  const [lastFixResult, setLastFixResult] = useState<FixResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelectedProviderIds(uniqSorted(defaultProviderIds));
    setResult(initialResult);
    setError(null);
    setLastFixResult(null);
    setPendingRun(null);
    setRunningFix(false);
  }, [open, defaultProviderIds, initialResult]);

  const issues = useMemo(() => {
    return (result?.issues || []).slice().sort(issueSort);
  }, [result]);

  const grouped = useMemo(() => {
    const critical = issues.filter((i) => i.severity === "critical");
    const warning = issues.filter((i) => i.severity === "warning");
    const info = issues.filter((i) => i.severity === "info");
    return { critical, warning, info };
  }, [issues]);

  const statusBadge = useMemo(() => {
    if (!result) return null;
    if (grouped.critical.length > 0) {
      return {
        icon: <XCircle className="h-4 w-4 text-red-600" />,
        text: translations.environment?.blocked || "存在阻断问题",
      };
    }
    if (grouped.warning.length > 0) {
      return {
        icon: <AlertTriangle className="h-4 w-4 text-yellow-600" />,
        text: translations.environment?.warning || "存在警告",
      };
    }
    return {
      icon: <CheckCircle2 className="h-4 w-4 text-green-600" />,
      text: translations.environment?.ready || "已就绪",
    };
  }, [grouped.critical.length, grouped.warning.length, result, translations.environment]);

  const handleCheck = async () => {
    setChecking(true);
    setError(null);
    try {
      const res = await runEnvironmentCheck(selectedProviderIds);
      setResult(res);
      onChecked?.(res);
    } catch (err) {
      const msg = String(err);
      setError(msg);
      toast.error(translations.environment?.checkFailed || "环境检查失败", {
        description: msg,
      });
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    if (result) return;
    void handleCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggleProvider = (id: string, enabled: boolean) => {
    setSelectedProviderIds((prev) => {
      const set = new Set(prev);
      if (enabled) set.add(id);
      else set.delete(id);
      const next = Array.from(set);
      return next.length === 0 ? ["dotnet"] : uniqSorted(next);
    });
  };

  const handleCopy = async (command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      toast.success(translations.environment?.copied || "已复制命令");
    } catch (err) {
      window.prompt(translations.environment?.copyFallback || "复制命令：", command);
    }
  };

  const handleApplyFix = async (fix: FixAction) => {
    if (fix.action_type === "copy_command") {
      if (!fix.command) {
        toast.error("Command is missing");
        return;
      }
      await handleCopy(fix.command);
      return;
    }

    if (fix.action_type === "manual") {
      toast.message(fix.label);
      return;
    }

    if (fix.action_type === "run_command") {
      setPendingRun(fix);
      return;
    }

    // open_url
    try {
      setRunningFix(true);
      const res = await applyFix(fix);
      setLastFixResult(res);
      toast.success(translations.environment?.opened || "已打开页面");
    } catch (err) {
      toast.error(translations.environment?.fixFailed || "修复失败", {
        description: String(err),
      });
    } finally {
      setRunningFix(false);
    }
  };

  const confirmRun = async () => {
    if (!pendingRun) return;
    try {
      setRunningFix(true);
      const res = await applyFix(pendingRun);
      setLastFixResult(res);
      if (res.result === "CommandExecuted" && res.data.exit_code === 0) {
        toast.success(translations.environment?.runSuccess || "命令执行完成");
      } else {
        toast.error(translations.environment?.runFailed || "命令执行失败");
      }
      await handleCheck();
    } catch (err) {
      toast.error(translations.environment?.runFailed || "命令执行失败", {
        description: String(err),
      });
    } finally {
      setRunningFix(false);
      setPendingRun(null);
    }
  };

  const fixResultText = useMemo(() => formatFixResult(lastFixResult), [lastFixResult]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[720px] max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Terminal className="h-5 w-5" />
              {translations.environment?.title || "环境检查"}
            </DialogTitle>
            <DialogDescription>
              {translations.environment?.description ||
                "检测本机工具链并提供修复建议"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 overflow-y-auto pr-1">
            <div className="space-y-2">
              <Label>{translations.environment?.scope || "检查范围"}</Label>
              <div className="grid grid-cols-2 gap-3">
                {ALL_PROVIDERS.map((p) => {
                  const checked = selectedProviderIds.includes(p.id);
                  return (
                    <div
                      key={p.id}
                      className="flex items-center justify-between rounded-md border p-3"
                    >
                      <div className="space-y-0.5">
                        <div className="text-sm font-medium">{p.label}</div>
                        <div className="text-xs text-muted-foreground">
                          {p.description}
                        </div>
                      </div>
                      <Switch
                        checked={checked}
                        onCheckedChange={(v) => toggleProvider(p.id, v)}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-1">
                <div className="text-sm font-medium">
                  {translations.environment?.status || "环境状态"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {result ? (
                    <span className="inline-flex items-center gap-2">
                      {statusBadge?.icon}
                      <span>{statusBadge?.text}</span>
                      <span className="opacity-60">{result.checked_at}</span>
                    </span>
                  ) : (
                    translations.environment?.unknown || "未检查"
                  )}
                </div>
              </div>
              <Button
                variant="outline"
                onClick={handleCheck}
                disabled={checking || runningFix}
              >
                {checking ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {translations.environment?.checking || "检查中..."}
                  </>
                ) : (
                  translations.environment?.recheck || "重新检查"
                )}
              </Button>
            </div>

            {error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            {result && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>{translations.environment?.providers || "工具状态"}</Label>
                  <div className="grid grid-cols-1 gap-2">
                    {result.providers.map((p) => (
                      <div
                        key={p.provider_id}
                        className="flex items-center justify-between rounded-md border p-3 text-sm"
                      >
                        <div className="flex items-center gap-2">
                          {p.installed ? (
                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                          ) : (
                            <XCircle className="h-4 w-4 text-red-600" />
                          )}
                          <span className="font-medium">{p.provider_id}</span>
                          <span className="text-muted-foreground">
                            {p.version || "unknown"}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground truncate max-w-[360px]">
                          {p.path || ""}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>{translations.environment?.issues || "发现的问题"}</Label>
                  {issues.length === 0 ? (
                    <div className="rounded-md border p-3 text-sm text-muted-foreground">
                      {translations.environment?.noIssues || "未发现问题"}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {issues.map((issue, idx) => (
                        <div
                          key={`${issue.provider_id}-${issue.issue_type}-${idx}`}
                          className="rounded-md border p-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                {issue.severity === "critical" ? (
                                  <XCircle className="h-4 w-4 text-red-600" />
                                ) : issue.severity === "warning" ? (
                                  <AlertTriangle className="h-4 w-4 text-yellow-600" />
                                ) : (
                                  <CheckCircle2 className="h-4 w-4 text-blue-600" />
                                )}
                                <div className="text-sm font-medium">
                                  {issue.description}
                                </div>
                              </div>
                              <div className="text-xs text-muted-foreground">
                                <span className="mr-3">
                                  provider: {issue.provider_id}
                                </span>
                                {issue.current_value && (
                                  <span className="mr-3">
                                    current: {issue.current_value}
                                  </span>
                                )}
                                {issue.expected_value && (
                                  <span>
                                    expected: {issue.expected_value}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          {issue.fixes.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {issue.fixes.map((fix, fixIdx) => (
                                <Button
                                  key={`${fix.label}-${fixIdx}`}
                                  size="sm"
                                  variant={
                                    fix.action_type === "run_command"
                                      ? "default"
                                      : "outline"
                                  }
                                  onClick={() => handleApplyFix(fix)}
                                  disabled={checking || runningFix}
                                >
                                  {fix.action_type === "open_url" ? (
                                    <ExternalLink className="h-4 w-4 mr-2" />
                                  ) : fix.action_type === "copy_command" ? (
                                    <Copy className="h-4 w-4 mr-2" />
                                  ) : (
                                    <Terminal className="h-4 w-4 mr-2" />
                                  )}
                                  {fix.label}
                                </Button>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {fixResultText && (
                  <div className="space-y-2">
                    <Label>{translations.environment?.result || "执行结果"}</Label>
                    <pre className="rounded-md border bg-muted p-3 text-xs whitespace-pre-wrap max-h-56 overflow-auto">
                      {fixResultText}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {translations.environment?.close || "关闭"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm run command */}
      <Dialog open={!!pendingRun} onOpenChange={(v) => !v && setPendingRun(null)}>
        <DialogContent className="sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle>
              {translations.environment?.confirmTitle || "确认执行命令"}
            </DialogTitle>
            <DialogDescription>
              {translations.environment?.confirmDesc ||
                "该操作将执行系统命令，可能会安装或修改本地环境。请确认命令内容无误。"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label>{translations.environment?.commandPreview || "命令预览"}</Label>
            <pre className="rounded-md border bg-muted p-3 text-xs whitespace-pre-wrap max-h-40 overflow-auto">
              {pendingRun?.command || ""}
            </pre>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPendingRun(null)}
              disabled={runningFix}
            >
              {translations.environment?.cancel || "取消"}
            </Button>
            <Button onClick={confirmRun} disabled={runningFix}>
              {runningFix ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {translations.environment?.running || "执行中..."}
                </>
              ) : (
                translations.environment?.run || "执行"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

