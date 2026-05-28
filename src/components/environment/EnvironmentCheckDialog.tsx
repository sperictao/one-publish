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


import { cn } from "@/lib/utils";
import { AppDialogShell } from "@/components/ui/app-dialog-shell";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

import {
  applyFix,
  createEnvironmentCheckSnapshot,
  DEFAULT_ENVIRONMENT_PROVIDER_IDS,
  normalizeEnvironmentProviderIds,
  runEnvironmentCheck,
  type EnvironmentCheckSnapshot,
  type EnvironmentCheckResult,
  type EnvironmentIssue,
  type FixAction,
  type FixResult,
  type IssueSeverity,
} from "@/lib/environment";
import { useI18n } from "@/hooks/useI18n";
import { resolveEnvironmentProviderOptions } from "@/lib/providers";
import type { ProviderManifest } from "@/lib/store";

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
  providers: ProviderManifest[];
  defaultProviderIds?: string[];
  initialCheck?: EnvironmentCheckSnapshot | null;
  onChecked?: (snapshot: EnvironmentCheckSnapshot) => void;
  onProviderIdsChange?: (providerIds: string[]) => void;
}

export interface EnvironmentCheckContentProps {
  active: boolean;
  providers: ProviderManifest[];
  defaultProviderIds?: string[];
  initialCheck?: EnvironmentCheckSnapshot | null;
  onChecked?: (snapshot: EnvironmentCheckSnapshot) => void;
  onProviderIdsChange?: (providerIds: string[]) => void;
}

export function EnvironmentCheckContent({
  active,
  providers,
  defaultProviderIds = DEFAULT_ENVIRONMENT_PROVIDER_IDS,
  initialCheck = null,
  onChecked,
  onProviderIdsChange,
}: EnvironmentCheckContentProps) {
  const { translations } = useI18n();
  const providerOptions = useMemo(
    () => resolveEnvironmentProviderOptions(providers),
    [providers]
  );
  const availableProviderIds = useMemo(
    () => providerOptions.map((provider) => provider.id),
    [providerOptions]
  );

  const normalizeVisibleProviderIds = (providerIds?: string[]) => {
    const normalizedIds = normalizeEnvironmentProviderIds(providerIds);
    if (availableProviderIds.length === 0) {
      return normalizedIds;
    }

    const visibleIds = normalizedIds.filter((providerId) =>
      availableProviderIds.includes(providerId)
    );
    return visibleIds.length > 0 ? visibleIds : [availableProviderIds[0]];
  };

  const [selectedProviderIds, setSelectedProviderIds] = useState<string[]>(
    normalizeVisibleProviderIds(defaultProviderIds)
  );
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<EnvironmentCheckResult | null>(
    initialCheck?.result || null
  );
  const [error, setError] = useState<string | null>(null);

  const [pendingRun, setPendingRun] = useState<FixAction | null>(null);
  const [runningFix, setRunningFix] = useState(false);
  const [lastFixResult, setLastFixResult] = useState<FixResult | null>(null);

  useEffect(() => {
    if (!active) return;
    setSelectedProviderIds(normalizeVisibleProviderIds(defaultProviderIds));
    setResult(initialCheck?.result || null);
    setError(null);
    setLastFixResult(null);
    setPendingRun(null);
    setRunningFix(false);
  }, [active, defaultProviderIds, initialCheck, availableProviderIds]);

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
        variant: "danger" as const,
      };
    }
    if (grouped.warning.length > 0) {
      return {
        icon: <AlertTriangle className="h-4 w-4 text-yellow-600" />,
        text: translations.environment?.warning || "存在警告",
        variant: "warning" as const,
      };
    }
    return {
      icon: <CheckCircle2 className="h-4 w-4 text-green-600" />,
      text: translations.environment?.ready || "已就绪",
      variant: "success" as const,
    };
  }, [grouped.critical.length, grouped.warning.length, result, translations.environment]);

  const handleCheck = async () => {
    setChecking(true);
    setError(null);
    try {
      const res = await runEnvironmentCheck(selectedProviderIds);
      const snapshot = createEnvironmentCheckSnapshot(res, selectedProviderIds);
      setResult(snapshot.result);
      onChecked?.(snapshot);
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
    if (!active) return;
    if (result) return;
    void handleCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const toggleProvider = (id: string, enabled: boolean) => {
    const nextSet = new Set(selectedProviderIds);
    if (enabled) nextSet.add(id);
    else nextSet.delete(id);

    const nextSelectedProviderIds = normalizeEnvironmentProviderIds(Array.from(nextSet));
    setSelectedProviderIds(nextSelectedProviderIds);
    onProviderIdsChange?.(nextSelectedProviderIds);
    setResult(null);
    setError(null);
    setLastFixResult(null);
  };

  const handleCopy = async (command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      toast.success(translations.environment?.copied || "已复制命令");
    } catch {
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
      <div className="space-y-4 py-2">
        {/* 1. 环境健康状态 (Hero Section) */}
        <div
          className={cn(
            "border rounded-2xl p-4 flex items-center justify-between gap-4 shadow-none transition-all duration-300",
            result
              ? grouped.critical.length > 0
                ? "bg-red-500/[0.04] border-red-500/20 shadow-[0_4px_16px_rgba(239,68,68,0.06)]"
                : grouped.warning.length > 0
                  ? "bg-amber-500/[0.04] border-amber-500/20 shadow-[0_4px_16px_rgba(245,158,11,0.06)]"
                  : "bg-emerald-500/[0.04] border-emerald-500/20 shadow-[0_4px_16px_rgba(16,185,129,0.06)]"
              : "glass-card bg-white/25 dark:bg-black/15 border-white/10 dark:border-white/5"
          )}
        >
          <div className="space-y-1.5 flex-1 min-w-0">
            <div className="text-xs font-semibold text-zinc-500/80 uppercase tracking-wider px-1">
              {translations.environment?.status || "环境状态"}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {result ? (
                <>
                  <span
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border shadow-none",
                      grouped.critical.length > 0
                        ? "bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-900/50"
                        : grouped.warning.length > 0
                          ? "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900/50"
                          : "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900/50"
                    )}
                  >
                    {statusBadge?.icon}
                    {statusBadge?.text}
                  </span>
                  <span className="text-xs text-muted-foreground opacity-80 self-center">
                    {result.checked_at}
                  </span>
                </>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {translations.environment?.unknown || "未检查"}
                </span>
              )}
            </div>
          </div>
          <Button
            variant="outline"
            onClick={handleCheck}
            disabled={checking || runningFix}
            className="glass-interactive rounded-full border border-white/15 dark:border-white/5 bg-white/20 dark:bg-white/5 text-[#0066cc] dark:text-[#2997ff] hover:bg-white/30 dark:hover:bg-white/10 active:scale-95 transition-all duration-200 shadow-none text-xs font-semibold h-8 px-4 shrink-0"
          >
            {checking ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                {translations.environment?.checking || "检查中..."}
              </>
            ) : (
              translations.environment?.recheck || "重新检查"
            )}
          </Button>
        </div>

        {/* 2. 检查范围 */}
        <div className="glass-card bg-white/25 dark:bg-black/15 border border-white/10 dark:border-white/5 rounded-2xl p-5 space-y-3 shadow-none">
          <Label className="text-xs font-semibold text-zinc-500/80 uppercase tracking-wider block mb-1">
            {translations.environment?.scope || "检查范围"}
          </Label>
          <div className="grid grid-cols-2 gap-3">
            {providerOptions.map((p) => {
              const checked = selectedProviderIds.includes(p.id);
              return (
                <div
                  key={p.id}
                  onClick={() => toggleProvider(p.id, !checked)}
                  className="glass-interactive flex items-center justify-between rounded-xl border border-white/15 dark:border-white/5 bg-white/30 dark:bg-black/10 p-3 transition-all duration-200 cursor-pointer select-none active:scale-[0.99] shadow-none"
                >
                  <div className="space-y-0.5 pr-2">
                    <div className="text-sm font-medium">{p.label}</div>
                    <div className="text-xs text-muted-foreground line-clamp-1">
                      {p.description}
                    </div>
                  </div>
                  <Switch
                    checked={checked}
                    className="data-[state=checked]:bg-gradient-to-b data-[state=checked]:from-[#4cd964] data-[state=checked]:to-[#34c759] data-[state=checked]:shadow-[0_2px_8px_rgba(52,199,89,0.3)] data-[state=unchecked]:bg-black/10 dark:data-[state=unchecked]:bg-white/10 pointer-events-none border-none shadow-none"
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="border border-red-500/20 bg-red-500/[0.04] text-sm text-red-950 dark:text-red-400 rounded-2xl p-4 shadow-[0_4px_16px_rgba(239,68,68,0.06)]">
            {error}
          </div>
        )}

        {/* 3. 详细检查结果 */}
        {result && (
          <div className="space-y-4">
            {/* 工具状态 */}
            <div className="glass-card bg-white/25 dark:bg-black/15 border border-white/10 dark:border-white/5 rounded-2xl p-5 space-y-3 shadow-none">
              <Label className="text-xs font-semibold text-zinc-500/80 uppercase tracking-wider block mb-1">
                {translations.environment?.providers || "工具状态"}
              </Label>
              <div className="grid grid-cols-1 gap-2">
                {result.providers.map((provider) => (
                  <div
                    key={provider.provider_id}
                    className="border border-white/15 dark:border-white/5 bg-white/30 dark:bg-black/10 p-3 text-sm shadow-none rounded-xl flex items-center justify-between"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        className={cn(
                          "h-2 w-2 rounded-full shrink-0",
                          provider.installed ? "bg-emerald-500 animate-pulse" : "bg-red-500"
                        )}
                      />
                      <span className="font-semibold text-sm">{provider.provider_id}</span>
                      <span className="text-[11px] text-zinc-500 px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 font-mono border-none font-medium">
                        {provider.version || "unknown"}
                      </span>
                    </div>
                    <div className="text-[11px] text-zinc-500 font-mono truncate max-w-[280px] sm:max-w-[360px] bg-zinc-50 dark:bg-zinc-900/60 px-2 py-0.5 rounded border border-[#e0e0e0] dark:border-zinc-800 font-medium">
                      {provider.path || ""}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 发现的问题 */}
            <div className="glass-card bg-white/25 dark:bg-black/15 border border-white/10 dark:border-white/5 rounded-2xl p-5 space-y-3 shadow-none">
              <Label className="text-xs font-semibold text-zinc-500/80 uppercase tracking-wider block mb-1">
                {translations.environment?.issues || "发现的问题"}
              </Label>
              {issues.length === 0 ? (
                <div className="border border-white/15 dark:border-white/5 bg-white/30 dark:bg-black/10 p-3.5 text-sm text-zinc-500 shadow-none rounded-xl">
                  {translations.environment?.noIssues || "未发现问题"}
                </div>
              ) : (
                <div className="space-y-2">
                  {issues.map((issue, idx) => {
                    const isCritical = issue.severity === "critical";
                    const isWarning = issue.severity === "warning";
                    return (
                      <div
                        key={`${issue.provider_id}-${issue.issue_type}-${idx}`}
                        className={cn(
                          "rounded-xl border p-4 transition-all duration-200",
                          isCritical
                            ? "border-red-500/20 bg-red-500/[0.03] shadow-[0_4px_12px_rgba(239,68,68,0.04)] text-red-950 dark:text-red-400"
                            : isWarning
                              ? "border-amber-500/20 bg-amber-500/[0.03] shadow-[0_4px_12px_rgba(245,158,11,0.04)] text-amber-950 dark:text-amber-400"
                              : "border-white/15 dark:border-white/5 bg-white/30 dark:bg-black/10 shadow-none"
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 shrink-0">
                            {isCritical ? (
                              <XCircle className="h-4.5 w-4.5 text-red-500" />
                            ) : isWarning ? (
                              <AlertTriangle className="h-4.5 w-4.5 text-amber-500" />
                            ) : (
                              <CheckCircle2 className="h-4.5 w-4.5 text-[#0066cc]" />
                            )}
                          </div>

                          <div className="space-y-1.5 flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-semibold tracking-tight">
                                {issue.description}
                              </span>
                              <span
                                className={cn(
                                  "text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider shrink-0",
                                  isCritical
                                    ? "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400"
                                    : isWarning
                                      ? "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400"
                                      : "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400"
                                )}
                              >
                                {issue.severity}
                              </span>
                            </div>

                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground/80 font-mono">
                              <div>
                                <span className="text-muted-foreground/50">provider:</span>{" "}
                                <span className="text-foreground/75 font-medium">
                                  {issue.provider_id}
                                </span>
                              </div>
                              {issue.current_value && (
                                <div>
                                  <span className="text-muted-foreground/50">current:</span>{" "}
                                  <span className="text-foreground/75 font-medium">
                                    {issue.current_value}
                                  </span>
                                </div>
                              )}
                              {issue.expected_value && (
                                <div>
                                  <span className="text-muted-foreground/50">expected:</span>{" "}
                                  <span className="text-foreground/75 font-medium">
                                    {issue.expected_value}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        {issue.fixes.length > 0 && (
                          <div className="mt-3.5 flex flex-wrap gap-2 pt-2 border-t border-dashed border-black/5 dark:border-white/5">
                            {issue.fixes.map((fix, fixIdx) => (
                              <Button
                                key={`${fix.label}-${fixIdx}`}
                                size="sm"
                                variant={
                                  fix.action_type === "run_command" ? "default" : "outline"
                                }
                                onClick={() => handleApplyFix(fix)}
                                disabled={checking || runningFix}
                                className={cn(
                                  "transition-all duration-200 active:scale-95 shadow-none text-xs h-8 px-4 font-semibold rounded-full",
                                  fix.action_type === "run_command"
                                    ? "bg-gradient-to-b from-[#4fa2ff] to-[#0066cc] text-white shadow-[0_2px_8px_rgba(0,102,204,0.2)] hover:from-[#5cb0ff] hover:to-[#0073e6] border-none"
                                    : "glass-interactive border border-white/15 dark:border-white/5 bg-white/20 dark:bg-white/5 text-zinc-700 dark:text-zinc-300 hover:bg-white/30 dark:hover:bg-white/10"
                                )}
                              >
                                {fix.action_type === "open_url" ? (
                                  <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                                ) : fix.action_type === "copy_command" ? (
                                  <Copy className="h-3.5 w-3.5 mr-1.5" />
                                ) : (
                                  <Terminal className="h-3.5 w-3.5 mr-1.5" />
                                )}
                                {fix.label}
                              </Button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 执行结果 */}
            {fixResultText && (
              <div className="glass-card bg-white/25 dark:bg-black/15 border border-white/10 dark:border-white/5 rounded-2xl p-5 space-y-3 shadow-none">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1 shrink-0">
                      <span className="h-2 w-2 rounded-full bg-red-500/60" />
                      <span className="h-2 w-2 rounded-full bg-yellow-500/60" />
                      <span className="h-2 w-2 rounded-full bg-green-500/60" />
                    </div>
                    <span className="text-xs font-semibold text-zinc-500/80 uppercase tracking-wider ml-1">
                      {translations.environment?.result || "执行结果"}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleCopy(fixResultText)}
                    className="glass-interactive h-7 px-3.5 text-xs text-muted-foreground hover:text-foreground active:scale-95 transition-all duration-200 rounded-full border border-white/15 dark:border-white/5 bg-white/20 dark:bg-white/5 font-semibold"
                  >
                    <Copy className="h-3 w-3 mr-1" />
                    {translations.environment?.copied ? "复制" : "复制"}
                  </Button>
                </div>
                <pre className="rounded-xl border border-black/5 dark:border-white/5 bg-black/10 dark:bg-black/30 p-3 text-xs font-mono text-foreground/90 whitespace-pre-wrap max-h-56 overflow-auto glass-scrollbar shadow-none">
                  {fixResultText}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>

      <Dialog
        open={!!pendingRun}
        onOpenChange={(open) => !open && setPendingRun(null)}
      >
        <AppDialogShell
          size="compact"
          dialogClassName="sm:max-w-[640px]"
          title={translations.environment?.confirmTitle || "确认执行命令"}
          description={
            translations.environment?.confirmDesc ||
            "该操作将执行系统命令，可能会安装或修改本地环境。请确认命令内容无误。"
          }
          icon={<Terminal className="h-4 w-4" />}
          bodyInnerClassName="space-y-2"
          footer={
            <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                onClick={() => setPendingRun(null)}
                disabled={runningFix}
                className="glass-interactive h-9 px-4 text-xs rounded-full border border-white/15 dark:border-white/5 bg-white/20 dark:bg-white/5 text-zinc-700 dark:text-zinc-300 hover:bg-white/30 dark:hover:bg-white/10 transition-all duration-200 active:scale-95 shadow-none font-semibold"
              >
                {translations.environment?.cancel || "取消"}
              </Button>
              <Button
                onClick={confirmRun}
                disabled={runningFix}
                className="h-9 px-4.5 text-xs rounded-full bg-gradient-to-b from-[#4fa2ff] to-[#0066cc] text-white shadow-[0_2px_8px_rgba(0,102,204,0.2)] hover:from-[#5cb0ff] hover:to-[#0073e6] transition-all duration-200 active:scale-95 border-none font-bold"
              >
                {runningFix ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {translations.environment?.running || "执行中..."}
                  </>
                ) : (
                  translations.environment?.run || "执行"
                )}
              </Button>
            </div>
          }
        >
          <div className="glass-card bg-white/25 dark:bg-black/15 border border-white/10 dark:border-white/5 rounded-2xl p-4 space-y-3 shadow-none mt-2">
            <Label className="text-xs font-semibold text-zinc-500/80 uppercase tracking-wider block mb-1">
              {translations.environment?.commandPreview || "命令预览"}
            </Label>
            <pre className="rounded-xl border border-black/5 dark:border-white/5 bg-black/10 dark:bg-black/30 p-3 text-xs font-mono whitespace-pre-wrap max-h-40 overflow-auto text-foreground/90 shadow-none">
              {pendingRun?.command || ""}
            </pre>
          </div>
        </AppDialogShell>
      </Dialog>
    </>
  );
}

export function EnvironmentCheckDialog({
  open,
  onOpenChange,
  providers,
  defaultProviderIds = DEFAULT_ENVIRONMENT_PROVIDER_IDS,
  initialCheck = null,
  onChecked,
  onProviderIdsChange,
}: EnvironmentCheckDialogProps) {
  const { translations } = useI18n();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AppDialogShell
        size="default"
        surfaceClassName="max-h-[80vh]"
        title={translations.environment?.title || "环境检查"}
        description={translations.environment?.description || "检测本机工具链并提供修复建议"}
        icon={<Terminal className="h-4 w-4" />}
        bodyInnerClassName="pr-1"
        footer={
          <div className="flex w-full justify-end">
            <Button 
              variant="outline" 
              onClick={() => onOpenChange(false)}
              className="glass-interactive rounded-full border border-white/15 dark:border-white/5 bg-white/20 dark:bg-white/5 text-zinc-700 dark:text-zinc-300 hover:bg-white/30 dark:hover:bg-white/10 transition-all duration-200 active:scale-95 shadow-none text-sm font-semibold h-9 px-5"
            >
              {translations.environment?.close || "关闭"}
            </Button>
          </div>
        }
      >
        <EnvironmentCheckContent
          active={open}
          providers={providers}
          defaultProviderIds={defaultProviderIds}
          initialCheck={initialCheck}
          onChecked={onChecked}
          onProviderIdsChange={onProviderIdsChange}
        />
      </AppDialogShell>
    </Dialog>
  );
}
