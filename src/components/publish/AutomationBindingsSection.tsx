import { useCallback, useEffect, useState } from "react";
import {
  ArrowUpCircle,
  GitBranchPlus,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Unlink,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SectionLabel } from "@/components/ui/section-label";
import { extractInvokeErrorMessage } from "@/lib/tauri/invokeErrors";
import {
  applyAutomationChange,
  listAutomationBindings,
  previewAutomationChange,
  type AutomationBindingsView,
  type AutomationChangeRequest,
  type AutomationProjectionPreview,
} from "@/lib/automationBindings";
import type { ConfigProfile } from "@/lib/store/types";

const GITHUB_ACTIONS_BACKEND_ID = "github-actions";
const DEFAULT_TAG_PREFIX = "v";

export interface AutomationBindingsSectionProps {
  repoId: string | null;
  profiles: ConfigProfile[];
  configPanelT: Record<string, string | undefined>;
}

interface PendingPreview {
  preview: AutomationProjectionPreview;
  applying: boolean;
}

export function AutomationBindingsSection({
  repoId,
  profiles,
  configPanelT,
}: AutomationBindingsSectionProps) {
  const [view, setView] = useState<AutomationBindingsView | null>(null);
  const [loading, setLoading] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [installProfileId, setInstallProfileId] = useState<string>("");
  const [installTagPrefix, setInstallTagPrefix] =
    useState<string>(DEFAULT_TAG_PREFIX);
  const [pending, setPending] = useState<PendingPreview | null>(null);

  // #63 只迁移现有 Tauri workflow；第二 Provider 的远端投影由后续 Ticket 扩展。
  const activeProfiles = profiles.filter(
    (profile) => profile.providerId === "tauri"
  );

  const refresh = useCallback(async () => {
    if (!repoId) {
      setView(null);
      return;
    }
    setLoading(true);
    try {
      setView(await listAutomationBindings(repoId));
    } catch (error) {
      setView(null);
      toast.error(configPanelT.automationLoadFailed || "自动化绑定加载失败", {
        description: extractInvokeErrorMessage(error),
      });
    } finally {
      setLoading(false);
    }
  }, [repoId, configPanelT]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const requestPreview = useCallback(
    async (change: AutomationChangeRequest) => {
      if (!repoId) return;
      try {
        const preview = await previewAutomationChange(repoId, change);
        setPending({ preview, applying: false });
      } catch (error) {
        toast.error(
          configPanelT.automationPreviewFailed || "投影差异预览失败",
          { description: extractInvokeErrorMessage(error) }
        );
      }
    },
    [repoId, configPanelT]
  );

  const confirmApply = useCallback(async () => {
    if (!repoId || !pending) return;
    setPending({ ...pending, applying: true });
    try {
      await applyAutomationChange(
        repoId,
        pending.preview.change,
        pending.preview.confirmationDigest
      );
      toast.success(configPanelT.automationApplied || "自动化投影已应用");
      setPending(null);
      setInstallOpen(false);
      await refresh();
    } catch (error) {
      setPending((current) =>
        current ? { ...current, applying: false } : current
      );
      toast.error(configPanelT.automationApplyFailed || "自动化投影应用失败", {
        description: extractInvokeErrorMessage(error),
      });
    }
  }, [pending, refresh, repoId, configPanelT]);

  const startInstallPreview = useCallback(() => {
    if (!installProfileId) return;
    void requestPreview({
      kind: "install",
      configurationId: installProfileId,
      executionBackendId: GITHUB_ACTIONS_BACKEND_ID,
      triggerPolicy: {
        type: "tagPush",
        tagPrefix: installTagPrefix || DEFAULT_TAG_PREFIX,
      },
      bindingId: null,
      confirmedConflictPaths: [],
    });
  }, [installProfileId, installTagPrefix, requestPreview]);

  if (!repoId) {
    return null;
  }

  const drift = view?.drift ?? [];
  const bindings = view?.bindings ?? [];
  const changeKindLabel = (kind: string) =>
    kind === "added"
      ? configPanelT.automationChangeAdded || "新增"
      : kind === "updated"
        ? configPanelT.automationChangeUpdated || "更新"
        : configPanelT.automationChangeRemoved || "移除";

  return (
    <div className="px-3 py-2" data-testid="automation-bindings-section">
      <div className="flex items-center justify-between">
        <SectionLabel>
          {configPanelT.automationSection || "自动化绑定"}
        </SectionLabel>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-label-12"
            onClick={() => void refresh()}
            aria-label={configPanelT.automationRefresh || "刷新自动化绑定"}
          >
            {loading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-label-12"
            onClick={() => {
              setInstallProfileId(activeProfiles[0]?.id ?? "");
              setInstallTagPrefix(DEFAULT_TAG_PREFIX);
              setInstallOpen(true);
            }}
            disabled={activeProfiles.length === 0}
          >
            <GitBranchPlus className="mr-1 size-3.5" />
            {configPanelT.automationInstall || "绑定自动化"}
          </Button>
        </div>
      </div>

      {drift.length > 0 ? (
        <div
          className="mt-2 rounded-sm border border-amber-600/40 bg-amber-500/10 px-3 py-2"
          role="alert"
          data-testid="automation-drift-banner"
        >
          <div className="flex items-center gap-2 text-label-12 font-semibold text-amber-700 dark:text-amber-400">
            <ShieldAlert className="size-3.5" />
            {configPanelT.automationDriftBlocked ||
              "托管投影与仓库不一致，自动发布已阻断"}
          </div>
          <ul className="mt-1 space-y-0.5 text-label-12 text-muted-foreground">
            {drift.map((change) => (
              <li key={`drift-${change.path}`} className="truncate">
                {changeKindLabel(change.kind)} · {change.path}
              </li>
            ))}
          </ul>
          <Button
            variant="outline"
            size="sm"
            className="mt-2 h-7 px-2 text-label-12"
            onClick={() => void requestPreview({ kind: "reconcile" })}
          >
            {configPanelT.automationUpdate || "更新配置"}
          </Button>
        </div>
      ) : null}

      {bindings.length === 0 ? (
        <p className="mt-2 text-label-12 text-muted-foreground">
          {loading
            ? configPanelT.automationLoading || "正在加载自动化绑定…"
            : configPanelT.automationNoBindings || "尚未绑定远端自动化"}
        </p>
      ) : (
        <ul className="mt-2 space-y-1">
          {bindings.map((item) => {
            const triggerLabel =
              item.binding.triggerPolicy.type === "tagPush"
                ? `${configPanelT.automationTriggerTagPush || "标签推送"} (${item.binding.triggerPolicy.tagPrefix}*)`
                : configPanelT.automationTriggerManual || "手动触发";
            return (
              <li
                key={item.binding.id}
                className="flex items-center justify-between gap-2 rounded-sm border border-border px-2 py-1.5"
                data-testid={`automation-binding-${item.binding.id}`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-label-13 font-medium text-foreground">
                      {item.configurationName ||
                        configPanelT.automationUnknownConfiguration ||
                        "未知配置"}
                    </span>
                    {item.blockedReason ? (
                      <span
                        className="rounded-sm bg-amber-500/15 px-1.5 py-0.5 text-label-12 font-medium text-amber-700 dark:text-amber-400"
                        data-testid={`automation-binding-blocked-${item.binding.id}`}
                      >
                        {configPanelT.automationDriftBadge || "漂移阻断"}
                      </span>
                    ) : null}
                  </div>
                  <p className="truncate text-label-12 text-muted-foreground">
                    {triggerLabel} · {item.binding.executionBackendId} ·{" "}
                    {configPanelT.automationRevisionPrefix || "修订"}{" "}
                    {item.binding.configurationRevisionId.slice(-8)}
                  </p>
                  <p className="break-all text-label-12 text-muted-foreground">
                    {configPanelT.automationCurrentRuntime || "当前 Runtime："}
                    {item.currentRuntimeRevision}
                  </p>
                  <p className="break-all text-label-12 text-muted-foreground">
                    {configPanelT.automationExpectedRuntime || "期望 Runtime："}
                    {item.expectedRuntimeRevision}
                  </p>
                  <span
                    className={
                      item.runtimeUpgradeAvailable
                        ? "inline-flex rounded-sm bg-amber-500/15 px-1.5 py-0.5 text-label-12 font-medium text-amber-700 dark:text-amber-400"
                        : "inline-flex rounded-sm bg-success/10 px-1.5 py-0.5 text-label-12 font-medium text-success"
                    }
                    data-testid={`automation-runtime-status-${item.binding.id}`}
                  >
                    {item.runtimeUpgradeAvailable
                      ? configPanelT.automationRuntimeUpgradeAvailable ||
                        "可升级"
                      : configPanelT.automationRuntimeCurrent ||
                        "Runtime 已是最新"}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-label-12"
                    onClick={() =>
                      void requestPreview({
                        kind: "upgradeRevision",
                        bindingId: item.binding.id,
                      })
                    }
                  >
                    <ArrowUpCircle className="mr-1 size-3.5" />
                    {configPanelT.automationUpgrade || "升级修订"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-label-12 text-red-700 hover:text-red-700 dark:text-red-400"
                    onClick={() =>
                      void requestPreview({
                        kind: "detach",
                        bindingId: item.binding.id,
                      })
                    }
                  >
                    <Unlink className="mr-1 size-3.5" />
                    {configPanelT.automationDetach || "解除绑定"}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog
        open={installOpen && !pending}
        onOpenChange={(open) => {
          if (!open) setInstallOpen(false);
        }}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>
              {configPanelT.automationInstallTitle || "绑定远端自动化"}
            </DialogTitle>
            <DialogDescription>
              {configPanelT.automationInstallHint ||
                "绑定固定当前配置修订；应用前会展示完整投影差异。"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label
                htmlFor="automation-install-configuration"
                className="mb-1 inline-block text-label-12 font-semibold text-muted-foreground"
              >
                {configPanelT.automationConfigurationLabel || "发布配置"}
              </Label>
              <Select
                value={installProfileId}
                onValueChange={setInstallProfileId}
              >
                <SelectTrigger
                  id="automation-install-configuration"
                  className="h-8 text-label-12"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {activeProfiles.map((profile) => (
                    <SelectItem
                      key={profile.id}
                      value={profile.id}
                      className="text-label-12"
                    >
                      {profile.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label
                htmlFor="automation-install-tag-prefix"
                className="mb-1 inline-block text-label-12 font-semibold text-muted-foreground"
              >
                {configPanelT.automationTagPrefixLabel || "标签前缀"}
              </Label>
              <Input
                id="automation-install-tag-prefix"
                value={installTagPrefix}
                onChange={(event) => setInstallTagPrefix(event.target.value)}
                className="h-8 text-label-12"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setInstallOpen(false)}
            >
              {configPanelT.automationCancel || "取消"}
            </Button>
            <Button
              size="sm"
              onClick={startInstallPreview}
              disabled={!installProfileId}
            >
              {configPanelT.automationPreviewDiff || "预览投影差异"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>
              {configPanelT.automationPreviewTitle || "确认投影差异"}
            </DialogTitle>
            <DialogDescription>
              {configPanelT.automationPreviewHint ||
                "以下资源将以一次接入提交写入仓库默认分支；未列出的文件不会被触碰。"}
            </DialogDescription>
          </DialogHeader>
          {pending ? (
            pending.preview.changes.length === 0 ? (
              <p
                className="text-label-12 text-muted-foreground"
                data-testid="automation-preview-empty"
              >
                {configPanelT.automationPreviewEmpty ||
                  "仓库已与投影一致，无需变更。"}
              </p>
            ) : (
              <ul
                className="max-h-64 space-y-1 overflow-y-auto"
                data-testid="automation-preview-changes"
              >
                {pending.preview.changes.map((change) => (
                  <li
                    key={`preview-${change.path}`}
                    className="rounded-sm border border-border px-2 py-1.5"
                  >
                    <div className="flex items-center gap-2 text-label-12">
                      <span className="font-semibold text-foreground">
                        {change.conflictReleaseNamespace
                          ? configPanelT.automationChangeConflict || "冲突"
                          : changeKindLabel(change.kind)}
                      </span>
                      <span className="truncate text-muted-foreground">
                        {change.path}
                      </span>
                    </div>
                    {change.conflictReleaseNamespace &&
                    change.conflictDeliveryDestinationNamespace ? (
                      <p className="mt-1 text-label-12 text-amber-700 dark:text-amber-400">
                        {change.conflictReleaseNamespace} ·{" "}
                        {change.conflictDeliveryDestinationNamespace}
                      </p>
                    ) : null}
                    {change.currentContent ? (
                      <div className="mt-1">
                        <span className="text-label-12 font-medium text-muted-foreground">
                          {configPanelT.automationCurrentContent || "当前内容"}
                        </span>
                        <pre className="mt-0.5 max-h-24 overflow-auto rounded-sm bg-muted px-2 py-1 text-label-12 text-muted-foreground">
                          {change.currentContent}
                        </pre>
                      </div>
                    ) : null}
                    {change.expectedContent ? (
                      <div className="mt-1">
                        <span className="text-label-12 font-medium text-muted-foreground">
                          {configPanelT.automationExpectedContent || "期望内容"}
                        </span>
                        <pre className="mt-0.5 max-h-24 overflow-auto rounded-sm bg-muted px-2 py-1 text-label-12 text-muted-foreground">
                          {change.expectedContent}
                        </pre>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )
          ) : null}
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPending(null)}
              disabled={pending?.applying}
            >
              {configPanelT.automationCancel || "取消"}
            </Button>
            <Button
              size="sm"
              onClick={() => void confirmApply()}
              disabled={pending?.applying}
              data-testid="automation-confirm-apply"
            >
              {pending?.applying ? (
                <Loader2 className="mr-1 size-3.5 animate-spin" />
              ) : null}
              {configPanelT.automationConfirmApply || "确认并应用"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
