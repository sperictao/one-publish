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
import { SwitchIndicator } from "@/components/ui/switch";

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
} from "@/features/environment/environment";
import { useI18n } from "@/hooks/useI18n";
import { resolveEnvironmentProviderOptions } from "@/features/provider/providers";
import type { ProviderManifest } from "@/lib/store/types";

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
    () => normalizeVisibleProviderIds(defaultProviderIds)
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
        icon: <XCircle className="size-4 text-red-600" />,
        text: translations.environment?.blocked || "存在阻断问题",
        variant: "danger" as const,
      };
    }
    if (grouped.warning.length > 0) {
      return {
        icon: <AlertTriangle className="size-4 text-yellow-600" />,
        text: translations.environment?.warning || "存在警告",
        variant: "warning" as const,
      };
    }
    return {
      icon: <CheckCircle2 className="size-4 text-green-600" />,
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
            "border rounded-xl p-4 flex items-center justify-between gap-4 shadow-[0_1px_3px_rgba(0,0,0,0.01)] transition-all duration-300",
            result
              ? grouped.critical.length > 0
                ? "bg-red-500/[0.04] border-red-500/20 dark:bg-red-500/[0.06]"
                : grouped.warning.length > 0
                  ? "bg-amber-500/[0.04] border-amber-500/20 dark:bg-amber-500/[0.06]"
                  : "bg-emerald-500/[0.04] border-emerald-500/20 dark:bg-emerald-500/[0.06]"
              : "border-[var(--settings-hairline)] bg-[var(--settings-section-bg)]"
          )}
        >
          <div className="space-y-1 flex-1 min-w-0">
            <div className="text-xs font-semibold text-[var(--settings-ink-muted)] uppercase tracking-wider px-1">
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
                  <span className="text-xs text-[var(--settings-ink-muted)] opacity-80 self-center">
                    {result.checked_at}
                  </span>
                </>
              ) : (
                <span className="text-xs text-[var(--settings-ink-muted)]">
                  {translations.environment?.unknown || "未检查"}
                </span>
              )}
            </div>
          </div>
          <Button
            variant="outline"
            onClick={handleCheck}
            disabled={checking || runningFix}
            className="rounded-lg border border-[#d1d1d6] border-b-[#b5b5ba] bg-gradient-to-b from-white to-[#f5f5f7] text-[12px] font-bold text-black/80 shadow-[0_1px_1px_rgba(0,0,0,0.05)] hover:from-[#f5f5f7] hover:to-[#e9e9eb] dark:from-[#3a3a3c] dark:to-[#2c2c2e] dark:border-[#48484a] dark:border-b-[#1c1c1e] dark:hover:from-[#48484a] dark:hover:to-[#3a3a3c] dark:text-white/90 active:scale-[0.97] transition-all shrink-0 flex items-center gap-1.5 h-8 px-4"
          >
            {checking ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                <span>{translations.environment?.checking || "检查中..."}</span>
              </>
            ) : (
              <span>{translations.environment?.recheck || "重新检查"}</span>
            )}
          </Button>
        </div>

        {/* 2. 检查范围 */}
        <div className="rounded-xl border border-[var(--settings-hairline)] bg-[var(--settings-section-bg)] p-5 space-y-3 shadow-[0_1px_3px_rgba(0,0,0,0.01)]">
          <Label className="text-xs font-semibold text-[var(--settings-ink-muted)] uppercase tracking-wider block mb-1">
            {translations.environment?.scope || "检查范围"}
          </Label>
          <div className="grid grid-cols-2 gap-3">
            {providerOptions.map((p) => {
              const checked = selectedProviderIds.includes(p.id);
              return (
                <button
                  type="button"
                  key={p.id}
                  aria-pressed={checked}
                  onClick={() => toggleProvider(p.id, !checked)}
                  className={cn(
                    "flex items-center justify-between rounded-xl border p-3.5 text-left transition-all duration-300 cursor-pointer select-none active:scale-[0.98] glass-interactive shadow-none",
                    checked
                      ? "border-[var(--settings-card-selected-border)] bg-[var(--settings-card-selected-bg)]"
                      : "border-[var(--settings-hairline)] bg-transparent hover:bg-black/[0.015] dark:hover:bg-white/[0.015] hover:border-black/20 dark:hover:border-white/20"
                  )}
                >
                  <div className="space-y-0.5 pr-2">
                    <div className="text-sm font-semibold tracking-[-0.224px] text-[var(--settings-ink)]">{p.label}</div>
                    <div className="text-xs text-[var(--settings-ink-muted)] line-clamp-1">
                      {p.description}
                    </div>
                  </div>
                  <SwitchIndicator
                    checked={checked}
                    className="data-[state=checked]:bg-[var(--settings-accent)] data-[state=unchecked]:bg-black/10 dark:data-[state=unchecked]:bg-white/10 pointer-events-none border-none shadow-none"
                  />
                </button>
              );
            })}
          </div>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="border border-red-500/20 bg-red-500/[0.04] text-sm text-red-950 dark:text-red-400 rounded-xl p-4 shadow-[0_4px_16px_rgba(239,68,68,0.06)]">
            {error}
          </div>
        )}

        {/* 3. 详细检查结果 */}
        {result && (
          <div className="space-y-4">
            {/* 工具状态 */}
            <div className="rounded-xl border border-[var(--settings-hairline)] bg-[var(--settings-section-bg)] overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.01)]">
              <div className="px-5 py-4 border-b border-[var(--settings-hairline)]">
                <Label className="text-xs font-semibold text-[var(--settings-ink-muted)] uppercase tracking-wider block">
                  {translations.environment?.providers || "工具状态"}
                </Label>
              </div>
              <div className="divide-y divide-[var(--settings-hairline)]">
                {result.providers.map((provider) => (
                  <div
                    key={provider.provider_id}
                    className="flex items-center justify-between gap-4 p-4 hover:bg-black/[0.005] dark:hover:bg-white/[0.005] transition-colors duration-150 text-sm"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        className={cn(
                          "size-2 rounded-full shrink-0 transition-all duration-300",
                          provider.installed
                            ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)] subtle-pulse"
                            : "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]"
                        )}
                      />
                      <span className="font-semibold text-[13.5px] text-[var(--settings-ink)]">{provider.provider_id}</span>
                      <span className="text-[10px] text-[var(--settings-ink-muted)] px-1.5 py-0.5 rounded bg-black/[0.03] dark:bg-white/[0.06] font-mono font-medium border border-[var(--settings-hairline)]">
                        {provider.version || "unknown"}
                      </span>
                    </div>
                    <div className="text-[11px] text-[var(--settings-ink-muted)] font-mono truncate max-w-[280px] sm:max-w-[360px] bg-black/[0.02] dark:bg-white/[0.03] px-2 py-0.5 rounded border border-[var(--settings-hairline)] font-medium">
                      {provider.path || ""}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 发现的问题 */}
            <div className="rounded-xl border border-[var(--settings-hairline)] bg-[var(--settings-section-bg)] overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.01)]">
              <div className="px-5 py-4 border-b border-[var(--settings-hairline)]">
                <Label className="text-xs font-semibold text-[var(--settings-ink-muted)] uppercase tracking-wider block">
                  {translations.environment?.issues || "发现的问题"}
                </Label>
              </div>
              <div className="p-5">
                {issues.length === 0 ? (
                  <div className="border border-[var(--settings-hairline)] bg-black/[0.01] dark:bg-white/[0.01] p-4 text-sm text-[var(--settings-ink-muted)] text-center rounded-xl">
                    {translations.environment?.noIssues || "未发现问题"}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {issues.map((issue, idx) => {
                      const isCritical = issue.severity === "critical";
                      const isWarning = issue.severity === "warning";
                      return (
                        <div
                          key={`${issue.provider_id}-${issue.issue_type}-${idx}`}
                          className={cn(
                            "rounded-xl border p-4 transition-all duration-200 glass-hover-lift",
                            isCritical
                              ? "border-red-500/15 bg-red-500/[0.01] dark:bg-red-500/[0.03] text-red-600 dark:text-red-400"
                              : isWarning
                                ? "border-amber-500/15 bg-amber-500/[0.01] dark:bg-amber-500/[0.03] text-amber-600 dark:text-amber-400"
                                : "border-[var(--settings-hairline)] bg-black/[0.01] dark:bg-white/[0.01] text-[var(--settings-ink)]"
                          )}
                        >
                          <div className="flex items-start gap-3">
                            <div className="mt-0.5 shrink-0">
                              {isCritical ? (
                                <XCircle className="size-4.5 text-red-500" />
                              ) : isWarning ? (
                                <AlertTriangle className="size-4.5 text-amber-500" />
                              ) : (
                                <CheckCircle2 className="size-4.5 text-[var(--settings-accent)]" />
                              )}
                            </div>

                            <div className="space-y-1.5 flex-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-semibold tracking-tight text-[var(--settings-ink)]">
                                  {issue.description}
                                </span>
                                <span
                                  className={cn(
                                    "text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider shrink-0",
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

                              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--settings-ink-muted)]/80 font-mono">
                                <div>
                                  <span className="opacity-60">provider:</span>{" "}
                                  <span className="text-[var(--settings-ink)] opacity-90 font-medium">
                                    {issue.provider_id}
                                  </span>
                                </div>
                                {issue.current_value && (
                                  <div>
                                    <span className="opacity-60">current:</span>{" "}
                                    <span className="text-[var(--settings-ink)] opacity-90 font-medium">
                                      {issue.current_value}
                                    </span>
                                  </div>
                                )}
                                {issue.expected_value && (
                                  <div>
                                    <span className="opacity-60">expected:</span>{" "}
                                    <span className="text-[var(--settings-ink)] opacity-90 font-medium">
                                      {issue.expected_value}
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>

                          {issue.fixes.length > 0 && (
                            <div className="mt-3.5 flex flex-wrap gap-2 pt-2 border-t border-dashed border-[var(--settings-hairline)]">
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
                                    "transition-all duration-200 active:scale-95 text-xs h-7.5 px-3.5 font-bold rounded-lg flex items-center gap-1.5 shrink-0 border",
                                    fix.action_type === "run_command"
                                      ? "bg-gradient-to-b from-[var(--settings-accent)] to-[var(--settings-accent)]/90 border-[var(--settings-accent)]/80 text-white shadow-[0_1px_2px_rgba(0,0,0,0.08),inset_0_1px_0_rgba(255,255,255,0.15)] hover:opacity-90"
                                      : "border-[var(--settings-hairline)] bg-transparent text-[var(--settings-ink)] hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
                                  )}
                                >
                                  {fix.action_type === "open_url" ? (
                                    <ExternalLink className="size-3" />
                                  ) : fix.action_type === "copy_command" ? (
                                    <Copy className="size-3" />
                                  ) : (
                                    <Terminal className="size-3" />
                                  )}
                                  <span>{fix.label}</span>
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
            </div>

            {/* 执行结果 */}
            {fixResultText && (
              <div className="rounded-xl border border-[var(--settings-hairline)] bg-[var(--settings-section-bg)] p-5 space-y-3 shadow-[0_1px_3px_rgba(0,0,0,0.01)]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1 shrink-0">
                      <span className="size-2 rounded-full bg-red-500/60" />
                      <span className="size-2 rounded-full bg-yellow-500/60" />
                      <span className="size-2 rounded-full bg-green-500/60" />
                    </div>
                    <span className="text-xs font-semibold text-[var(--settings-ink-muted)] uppercase tracking-wider ml-1">
                      {translations.environment?.result || "执行结果"}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleCopy(fixResultText)}
                    className="rounded-lg border border-[var(--settings-hairline)] bg-transparent hover:bg-black/[0.02] dark:hover:bg-white/[0.02] text-[11px] font-medium text-[var(--settings-ink)] active:scale-[0.97] transition-all h-7 px-3.5 flex items-center gap-1 shrink-0"
                  >
                    <Copy className="size-3 text-[var(--settings-ink-muted)]" />
                    <span>{translations.environment?.copied ? "复制" : "复制"}</span>
                  </Button>
                </div>
                <pre className="rounded-lg border border-[var(--settings-hairline)] bg-black/[0.03] dark:bg-white/[0.03] p-3 text-xs font-mono text-[var(--settings-ink)]/90 whitespace-pre-wrap max-h-56 overflow-auto glass-scrollbar shadow-none">
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
          icon={<Terminal className="size-4" />}
          bodyInnerClassName="space-y-2"
          footer={
            <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                onClick={() => setPendingRun(null)}
                disabled={runningFix}
                className="rounded-lg border border-[var(--settings-hairline)] bg-transparent hover:bg-black/[0.02] dark:hover:bg-white/[0.02] text-[12px] font-medium text-[var(--settings-ink)] active:scale-[0.97] transition-all h-9 px-4 shrink-0"
              >
                <span>{translations.environment?.cancel || "取消"}</span>
              </Button>
              <Button
                onClick={confirmRun}
                disabled={runningFix}
                className="rounded-lg bg-gradient-to-b from-[var(--settings-accent)] to-[var(--settings-accent)]/90 border-[var(--settings-accent)]/80 text-white shadow-[0_1px_2px_rgba(0,0,0,0.08),inset_0_1px_0_rgba(255,255,255,0.15)] hover:opacity-90 active:scale-[0.97] transition-all text-[12px] font-bold h-9 px-4.5 shrink-0 flex items-center justify-center"
              >
                {runningFix ? (
                  <>
                    <Loader2 className="mr-1.5 size-4 animate-spin" />
                    <span>{translations.environment?.running || "执行中..."}</span>
                  </>
                ) : (
                  <span>{translations.environment?.run || "执行"}</span>
                )}
              </Button>
            </div>
          }
        >
          <div className="rounded-xl border border-[var(--settings-hairline)] bg-[var(--settings-section-bg)] p-4 space-y-3 shadow-[0_1px_3px_rgba(0,0,0,0.01)] mt-2">
            <Label className="text-xs font-semibold text-[var(--settings-ink-muted)] uppercase tracking-wider block mb-1">
              {translations.environment?.commandPreview || "命令预览"}
            </Label>
            <pre className="rounded-lg border border-[var(--settings-hairline)] bg-black/[0.03] dark:bg-white/[0.03] p-3 text-xs font-mono whitespace-pre-wrap max-h-40 overflow-auto text-[var(--settings-ink)]/90 shadow-none">
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
        icon={<Terminal className="size-4" />}
        bodyInnerClassName="pr-1"
        footer={
          <div className="flex w-full justify-end">
            <Button 
              variant="outline" 
              onClick={() => onOpenChange(false)}
              className="rounded-full border border-[#d1d1d6] border-b-[#b5b5ba] bg-gradient-to-b from-white to-[#f5f5f7] text-sm font-bold text-black/80 shadow-[0_1px_1px_rgba(0,0,0,0.05)] hover:from-[#f5f5f7] hover:to-[#e9e9eb] dark:from-[#3a3a3c] dark:to-[#2c2c2e] dark:border-[#48484a] dark:border-b-[#1c1c1e] dark:hover:from-[#48484a] dark:hover:to-[#3a3a3c] dark:text-white/90 active:scale-[0.97] transition-all h-9 px-5 shrink-0 flex items-center justify-center"
            >
              <span>{translations.environment?.close || "关闭"}</span>
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
