import { useCallback, useEffect, useState } from "react";
import {
  ArrowUpCircle,
  GitBranchPlus,
  Loader2,
  Play,
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
import { RemoteEvidenceSection } from "@/components/publish/RemoteEvidenceSection";
import {
  applyAutomationChange,
  cancelRemotePublishRun,
  dispatchManualPublishRun,
  listAutomationBindings,
  previewAutomationChange,
  synchronizeRemoteEvidence,
  type AutomationBindingsView,
  type AutomationChangeRequest,
  type AutomationProjectionPreview,
  type RemoteAttemptEvidenceView,
} from "@/lib/automationBindings";
import type { ConfigProfile } from "@/lib/store/types";

const DEFAULT_TAG_PREFIX = "v";

interface RuntimeRevisionSection {
  runnerVersion: string;
  identifier: string;
  binaryDigests: Array<[string, string]>;
}

// 决议 #91：升级/安装预览对 runtime 投影文件展开 Runtime Revision 分节
// （runner 版本、per-target 摘要表、封存摘要），不再要求用户读原始 JSON。
function runtimeRevisionSection(change: {
  path: string;
  expectedContent: string | null;
}): RuntimeRevisionSection | null {
  if (
    !change.path.includes("/automation/runtime/") ||
    !change.expectedContent
  ) {
    return null;
  }
  try {
    const template = JSON.parse(change.expectedContent) as {
      runtime_revision?: {
        version?: number;
        digest?: string;
        runner?: { version?: string; binary_digests?: Record<string, string> };
      };
    };
    const revision = template.runtime_revision;
    if (!revision?.runner?.version) {
      return null;
    }
    return {
      runnerVersion: revision.runner.version,
      identifier: `runtime-v${revision.version ?? 1}-${revision.digest ?? ""}`,
      binaryDigests: Object.entries(revision.runner.binary_digests ?? {}),
    };
  } catch {
    return null;
  }
}

export interface AutomationBindingsSectionProps {
  repoId: string | null;
  profiles: ConfigProfile[];
  configPanelT: Record<string, string | undefined>;
  /** 决议 #91：修订 Backend 不可投影时引导拉起组合编辑器（预填 github-actions）。 */
  onGuideComposition?: (profileId: string) => void;
}

interface PendingPreview {
  preview: AutomationProjectionPreview;
  applying: boolean;
}

export function AutomationBindingsSection({
  repoId,
  profiles,
  configPanelT,
  onGuideComposition,
}: AutomationBindingsSectionProps) {
  const [view, setView] = useState<AutomationBindingsView | null>(null);
  const [loading, setLoading] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [installProfileId, setInstallProfileId] = useState<string>("");
  const [installTagPrefix, setInstallTagPrefix] =
    useState<string>(DEFAULT_TAG_PREFIX);
  const [pending, setPending] = useState<PendingPreview | null>(null);
  const [remoteEvidence, setRemoteEvidence] = useState<
    RemoteAttemptEvidenceView[] | null
  >(null);
  const [syncingRemote, setSyncingRemote] = useState(false);
  const [dispatchBindingId, setDispatchBindingId] = useState<string | null>(
    null
  );
  const [dispatchVersion, setDispatchVersion] = useState("");
  const [dispatching, setDispatching] = useState(false);
  const [cancellingRunId, setCancellingRunId] = useState<number | null>(null);

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

  const syncRemoteEvidence = useCallback(async () => {
    if (!repoId) return;
    setSyncingRemote(true);
    try {
      setRemoteEvidence(await synchronizeRemoteEvidence(repoId));
    } catch (error) {
      toast.error(
        configPanelT.automationRemoteSyncFailed || "远端发布记录同步失败",
        { description: extractInvokeErrorMessage(error) }
      );
    } finally {
      setSyncingRemote(false);
    }
  }, [repoId, configPanelT]);

  const confirmDispatch = useCallback(async () => {
    if (!repoId || !dispatchBindingId || !dispatchVersion.trim()) return;
    setDispatching(true);
    try {
      const result = await dispatchManualPublishRun(
        repoId,
        dispatchBindingId,
        dispatchVersion.trim()
      );
      toast.success(
        configPanelT.automationDispatchSuccess || "已触发远端发布",
        {
          description: `attempt ${result.attemptId}${
            result.runId != null ? ` · run #${result.runId}` : ""
          }`,
        }
      );
      setDispatchBindingId(null);
      setDispatchVersion("");
      await syncRemoteEvidence();
    } catch (error) {
      toast.error(configPanelT.automationDispatchFailed || "触发远端发布失败", {
        description: extractInvokeErrorMessage(error),
      });
    } finally {
      setDispatching(false);
    }
  }, [
    repoId,
    dispatchBindingId,
    dispatchVersion,
    configPanelT,
    syncRemoteEvidence,
  ]);

  const cancelRemoteRun = useCallback(
    async (attempt: RemoteAttemptEvidenceView) => {
      if (!repoId) return;
      setCancellingRunId(attempt.runId);
      try {
        await cancelRemotePublishRun(repoId, attempt.runId);
        toast.success(
          configPanelT.automationRemoteCancelSuccess || "已请求取消远端运行"
        );
        await syncRemoteEvidence();
      } catch (error) {
        toast.error(
          configPanelT.automationRemoteCancelFailed || "取消远端运行失败",
          { description: extractInvokeErrorMessage(error) }
        );
      } finally {
        setCancellingRunId(null);
      }
    },
    [repoId, configPanelT, syncRemoteEvidence]
  );

  const startInstallPreview = useCallback(() => {
    if (!installProfileId) return;
    void requestPreview({
      kind: "install",
      configurationId: installProfileId,
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
  // 决议 #91/#90：安装的引导判定与后端拒装判定同构——选中配置的当前修订
  // 组合必须以 github-actions 为执行后端，否则先引导保存新修订。
  const selectedInstallProfile = activeProfiles.find(
    (profile) => profile.id === installProfileId
  );
  const needsCompositionGuide =
    selectedInstallProfile !== undefined &&
    selectedInstallProfile.composition?.executionBackend.adapterId !==
      "github-actions";
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
                    onClick={() => {
                      setDispatchBindingId(item.binding.id);
                      setDispatchVersion("");
                    }}
                    data-testid={`automation-dispatch-${item.binding.id}`}
                  >
                    <Play className="mr-1 size-3.5" />
                    {configPanelT.automationDispatch || "手动触发"}
                  </Button>
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

      {bindings.length > 0 ? (
        <RemoteEvidenceSection
          evidence={remoteEvidence}
          syncing={syncingRemote}
          cancellingRunId={cancellingRunId}
          onSync={() => void syncRemoteEvidence()}
          onCancelRun={(attempt) => void cancelRemoteRun(attempt)}
          t={configPanelT}
        />
      ) : null}

      <Dialog
        open={dispatchBindingId !== null}
        onOpenChange={(open) => {
          if (!open && !dispatching) setDispatchBindingId(null);
        }}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>
              {configPanelT.automationDispatchTitle || "手动触发远端发布"}
            </DialogTitle>
            <DialogDescription>
              {configPanelT.automationDispatchHint ||
                "按此绑定的固定修订在远端后端发布指定版本；触发后可同步远端证据查看进度。"}
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label
              htmlFor="automation-dispatch-version"
              className="mb-1 inline-block text-label-12 font-semibold text-muted-foreground"
            >
              {configPanelT.automationVersionLabel || "发布版本"}
            </Label>
            <Input
              id="automation-dispatch-version"
              value={dispatchVersion}
              onChange={(event) => setDispatchVersion(event.target.value)}
              placeholder="1.2.3"
              className="h-8 text-label-12"
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDispatchBindingId(null)}
              disabled={dispatching}
            >
              {configPanelT.automationCancel || "取消"}
            </Button>
            <Button
              size="sm"
              onClick={() => void confirmDispatch()}
              disabled={dispatching || !dispatchVersion.trim()}
              data-testid="automation-dispatch-confirm"
            >
              {dispatching ? (
                <Loader2 className="mr-1 size-3.5 animate-spin" />
              ) : null}
              {configPanelT.automationDispatchConfirm || "触发发布"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            {needsCompositionGuide ? (
              <div
                className="rounded-sm border border-amber-600/40 bg-amber-500/10 px-3 py-2"
                data-testid="automation-composition-guide"
              >
                <p className="text-label-12 text-amber-700 dark:text-amber-400">
                  {configPanelT.automationCompositionGuide ||
                    "该配置的当前修订以本机执行发布。远端自动化的执行后端来自修订组合：请先保存 backend=github-actions 的新修订，再回到这里安装。"}
                </p>
                {onGuideComposition ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2 h-7 px-2 text-label-12"
                    onClick={() => {
                      setInstallOpen(false);
                      onGuideComposition(installProfileId);
                    }}
                  >
                    {configPanelT.automationEditComposition || "去编辑发布组合"}
                  </Button>
                ) : null}
              </div>
            ) : null}
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
              disabled={!installProfileId || needsCompositionGuide}
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
                {pending.preview.changes.map((change) => {
                  const runtimeSection = runtimeRevisionSection(change);
                  return (
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
                      {runtimeSection ? (
                        <div
                          className="mt-1 rounded-sm bg-muted px-2 py-1"
                          data-testid={`automation-runtime-section-${change.path}`}
                        >
                          <p className="text-label-12 font-medium text-foreground">
                            {configPanelT.automationRuntimeSection ||
                              "Runtime Revision"}
                            {" · runner v"}
                            {runtimeSection.runnerVersion}
                          </p>
                          <p className="break-all text-label-12 text-muted-foreground">
                            {runtimeSection.identifier}
                          </p>
                          <ul className="mt-0.5 space-y-0.5">
                            {runtimeSection.binaryDigests.map(
                              ([target, digest]) => (
                                <li
                                  key={`digest-${change.path}-${target}`}
                                  className="truncate text-label-12 text-muted-foreground"
                                >
                                  {target}: {digest.slice(0, 16)}…
                                </li>
                              )
                            )}
                          </ul>
                        </div>
                      ) : null}
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
                            {configPanelT.automationCurrentContent ||
                              "当前内容"}
                          </span>
                          <pre className="mt-0.5 max-h-24 overflow-auto rounded-sm bg-muted px-2 py-1 text-label-12 text-muted-foreground">
                            {change.currentContent}
                          </pre>
                        </div>
                      ) : null}
                      {change.expectedContent ? (
                        <div className="mt-1">
                          <span className="text-label-12 font-medium text-muted-foreground">
                            {configPanelT.automationExpectedContent ||
                              "期望内容"}
                          </span>
                          <pre className="mt-0.5 max-h-24 overflow-auto rounded-sm bg-muted px-2 py-1 text-label-12 text-muted-foreground">
                            {change.expectedContent}
                          </pre>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
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
