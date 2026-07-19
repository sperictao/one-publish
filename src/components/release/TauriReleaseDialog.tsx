import { useCallback, useEffect, useMemo, useState } from "react";
import {
  open as openDialog,
  save as saveDialog,
} from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  CheckCircle2,
  CloudUpload,
  Download,
  FileCode2,
  FolderOutput,
  Github,
  Loader2,
  RefreshCw,
  Save,
  Settings2,
  Upload,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { AppDialogBadge } from "@/components/ui/app-dialog-badge";
import { AppDialogInset } from "@/components/ui/app-dialog-inset";
import { AppDialogShell } from "@/components/ui/app-dialog-shell";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  applyTauriWorkflowTakeover,
  cancelTauriReleaseAttempt,
  executeTauriLocalBuild,
  exportTauriReleaseConfig,
  getTauriReleaseConfig,
  importTauriReleaseConfig,
  inspectTauriRepository,
  listTauriReleaseAttempts,
  prepareTauriGithubRelease,
  previewTauriManagedWorkflow,
  refreshTauriReleaseAttempt,
  retryTauriReleaseAttempt,
  saveTauriReleaseConfig,
  startTauriGithubRelease,
} from "@/features/tauriRelease/tauriReleaseApi";
import type {
  ManagedWorkflowPreview,
  ReleaseAttempt,
  ReleaseGate,
  TauriAppInspection,
  TauriDesktopTarget,
  TauriLocalBuildResult,
  TauriReleaseConfig,
  TauriReleasePreflight,
  TauriRepositoryInspection,
} from "@/generated/tauri-contracts";
import { useI18n } from "@/hooks/useI18n";
import { openOutputDirectory } from "@/lib/store/api";
import type { Repository } from "@/lib/store/types";
import { cn } from "@/lib/utils";

type ReleaseTab = "config" | "local" | "github";

const TARGETS: Array<{ value: TauriDesktopTarget; label: string }> = [
  { value: "windows_x64", label: "Windows x64" },
  { value: "linux_x64", label: "Linux x64" },
  { value: "macos_x64", label: "macOS Intel" },
  { value: "macos_arm64", label: "macOS Apple Silicon" },
  { value: "macos_universal", label: "macOS Universal" },
];

const ACTIVE_STAGES = new Set([
  "preparing",
  "running_gates",
  "ready_to_push",
  "monitoring_workflow",
]);

function lines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function bumpPatch(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return match ? `${match[1]}.${match[2]}.${Number(match[3]) + 1}` : version;
}

function defaultConfig(app: TauriAppInspection): TauriReleaseConfig {
  return {
    appConfigPath: app.configPath,
    appName: app.appName,
    buildDriver: app.buildDriver,
    enabledTargets: TARGETS.map((target) => target.value),
    releaseAssetPatterns: [
      "*.dmg",
      "*.msi",
      "*-setup.exe",
      "*.AppImage",
      "*.deb",
    ],
    updater: {
      enabled: false,
      endpoint: null,
      publicKey: null,
      privateKeySecretName: null,
    },
    allowUnsignedRelease: true,
    requiredActionsSecretNames: [],
    actionsSecretEnvironment: {},
    tagPrefix: "v",
    releaseGates: [],
    localDeliveryDir: "dist/one-publish",
    versionMirrors: app.suggestedVersionMirrors,
    managedWorkflowVersion: 1,
  };
}

function parseEnvironmentMappings(value: string): Record<string, string> {
  return Object.fromEntries(
    lines(value).map((line) => {
      const separator = line.indexOf("=");
      if (separator <= 0 || separator === line.length - 1) {
        throw new Error(`无效的 Secret 环境映射：${line}`);
      }
      return [
        line.slice(0, separator).trim(),
        line.slice(separator + 1).trim(),
      ];
    })
  );
}

function parseGates(value: string): ReleaseGate[] {
  const parsed: unknown = JSON.parse(value || "[]");
  if (!Array.isArray(parsed)) {
    throw new Error("发布门禁必须是 JSON 数组");
  }
  return parsed as ReleaseGate[];
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-label-13">{label}</Label>
      {children}
      {hint ? (
        <p className="text-label-12 text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function stageTone(stage: ReleaseAttempt["stage"]) {
  if (stage === "published") return "success" as const;
  if (stage === "failed") return "danger" as const;
  if (stage === "cancelled") return "warning" as const;
  return "neutral" as const;
}

export interface TauriReleaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repository: Repository;
}

export function TauriReleaseDialog({
  open,
  onOpenChange,
  repository,
}: TauriReleaseDialogProps) {
  const { translations } = useI18n();
  const t = translations.tauriRelease || {};
  const [tab, setTab] = useState<ReleaseTab>("config");
  const [inspection, setInspection] =
    useState<TauriRepositoryInspection | null>(null);
  const [config, setConfig] = useState<TauriReleaseConfig | null>(null);
  const [draft, setDraft] = useState<TauriReleaseConfig | null>(null);
  const [secretEnvironmentText, setSecretEnvironmentText] = useState("");
  const [gatesText, setGatesText] = useState("[]");
  const [workflow, setWorkflow] = useState<ManagedWorkflowPreview | null>(null);
  const [takeoverConfirmed, setTakeoverConfirmed] = useState(false);
  const [attempts, setAttempts] = useState<ReleaseAttempt[]>([]);
  const [localResult, setLocalResult] = useState<TauriLocalBuildResult | null>(
    null
  );
  const [version, setVersion] = useState("");
  const [preflight, setPreflight] = useState<TauriReleasePreflight | null>(
    null
  );
  const [releaseNotes, setReleaseNotes] = useState("");
  const [unsignedConfirmed, setUnsignedConfirmed] = useState(false);
  const [monitorError, setMonitorError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<string | null>(null);

  const applyLoadedConfig = useCallback((next: TauriReleaseConfig) => {
    setConfig(next);
    setDraft(next);
    setSecretEnvironmentText(
      Object.entries(next.actionsSecretEnvironment)
        .map(([environment, secret]) => `${environment}=${secret}`)
        .join("\n")
    );
    setGatesText(JSON.stringify(next.releaseGates, null, 2));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextInspection, saved, nextAttempts] = await Promise.all([
        inspectTauriRepository(repository.path),
        getTauriReleaseConfig(repository.id),
        listTauriReleaseAttempts(repository.id),
      ]);
      setInspection(nextInspection);
      setAttempts(nextAttempts);
      const nextConfig = saved ?? defaultConfig(nextInspection.apps[0]);
      applyLoadedConfig(nextConfig);
      if (!saved) setConfig(null);
      setVersion(
        bumpPatch(
          nextInspection.apps.find(
            (app) => app.configPath === nextConfig.appConfigPath
          )?.versionSource.version ??
            nextInspection.apps[0].versionSource.version
        )
      );
      setPreflight(null);
      setReleaseNotes("");
      setUnsignedConfirmed(false);
      setWorkflow(
        saved ? await previewTauriManagedWorkflow(repository.id) : null
      );
    } catch (error) {
      toast.error(t.loadFailed || "加载 Tauri 发布状态失败", {
        description: String(error),
      });
    } finally {
      setLoading(false);
    }
  }, [applyLoadedConfig, repository.id, repository.path, t.loadFailed]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, open]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(async () => {
      try {
        let nextAttempts = await listTauriReleaseAttempts(repository.id);
        const monitoring = nextAttempts.find(
          (attempt) => attempt.stage === "monitoring_workflow"
        );
        if (monitoring) {
          const refreshed = await refreshTauriReleaseAttempt(monitoring.id);
          nextAttempts = nextAttempts.map((attempt) =>
            attempt.id === refreshed.id ? refreshed : attempt
          );
        }
        setAttempts(nextAttempts);
        setMonitorError(null);
      } catch (error) {
        setMonitorError(String(error));
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [open, repository.id]);

  const selectedApp = useMemo(
    () =>
      inspection?.apps.find((app) => app.configPath === draft?.appConfigPath),
    [draft?.appConfigPath, inspection?.apps]
  );

  const latestAttempt = attempts[0] ?? null;
  const activeAttempt = attempts.find((attempt) =>
    ACTIVE_STAGES.has(attempt.stage)
  );

  const runAction = useCallback(
    async (name: string, task: () => Promise<void>) => {
      setAction(name);
      try {
        await task();
      } catch (error) {
        toast.error(t.actionFailed || "操作失败", {
          description: String(error),
        });
      } finally {
        setAction(null);
      }
    },
    [t.actionFailed]
  );

  const saveConfig = () =>
    runAction("save", async () => {
      if (!draft) return;
      const next: TauriReleaseConfig = {
        ...draft,
        actionsSecretEnvironment: parseEnvironmentMappings(
          secretEnvironmentText
        ),
        releaseGates: parseGates(gatesText),
      };
      const saved = await saveTauriReleaseConfig(repository.id, next);
      applyLoadedConfig(saved);
      setWorkflow(await previewTauriManagedWorkflow(repository.id));
      setTakeoverConfirmed(false);
      toast.success(t.saved || "Tauri 发布配置已保存到 One Publish 本地状态");
    });

  const changeApp = (configPath: string) => {
    const app = inspection?.apps.find(
      (candidate) => candidate.configPath === configPath
    );
    if (!app || !draft) return;
    setDraft({
      ...draft,
      appConfigPath: app.configPath,
      appName: app.appName,
      buildDriver: app.buildDriver,
      versionMirrors: app.suggestedVersionMirrors,
    });
    setVersion(bumpPatch(app.versionSource.version));
    setPreflight(null);
  };

  const toggleTarget = (target: TauriDesktopTarget, checked: boolean) => {
    if (!draft) return;
    setDraft({
      ...draft,
      enabledTargets: checked
        ? [...draft.enabledTargets, target]
        : draft.enabledTargets.filter((value) => value !== target),
    });
  };

  const renderConfig = () => {
    if (!draft || !inspection) return null;
    return (
      <div className="space-y-5">
        <section className="space-y-4">
          <div>
            <h3 className="text-label-14 font-semibold">
              {t.projectBinding || "项目绑定"}
            </h3>
            <p className="mt-1 text-label-12 text-muted-foreground">
              {t.projectBindingHint ||
                "Tauri 项目优先于 Cargo 项目；多应用仓库必须明确选择一个配置文件。"}
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t.application || "Tauri 应用"}>
              <select
                className="surface-input h-10 w-full rounded-sm px-3 text-label-14"
                value={draft.appConfigPath}
                onChange={(event) => changeApp(event.target.value)}
              >
                {inspection.apps.map((app) => (
                  <option key={app.configPath} value={app.configPath}>
                    {app.appName} · {app.configPath}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label={t.driver || "构建驱动"}
              hint={
                t.driverHint ||
                "由 packageManager 与锁文件共同判定；冲突会阻断。"
              }
            >
              <Input value={draft.buildDriver} disabled />
            </Field>
            <Field label={t.tagPrefix || "Tag 前缀"}>
              <Input
                value={draft.tagPrefix}
                onChange={(event) =>
                  setDraft({ ...draft, tagPrefix: event.target.value })
                }
              />
            </Field>
            <Field label={t.localDeliveryDir || "本地交付目录"}>
              <Input
                value={draft.localDeliveryDir}
                onChange={(event) =>
                  setDraft({ ...draft, localDeliveryDir: event.target.value })
                }
              />
            </Field>
          </div>
          <Field label={t.targets || "GitHub 构建目标"}>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {TARGETS.map((target) => (
                <label
                  key={target.value}
                  className="flex items-center gap-2 rounded-sm border border-border p-3 text-label-13"
                >
                  <input
                    type="checkbox"
                    checked={draft.enabledTargets.includes(target.value)}
                    onChange={(event) =>
                      toggleTarget(target.value, event.target.checked)
                    }
                  />
                  {target.label}
                </label>
              ))}
            </div>
          </Field>
        </section>

        <section className="grid gap-4 border-t border-border pt-5 md:grid-cols-2">
          <Field
            label={t.assets || "发布产物白名单"}
            hint={t.assetsHint || "每行一个文件名 glob；不接受路径。"}
          >
            <Textarea
              className="min-h-36 font-mono text-label-12"
              value={draft.releaseAssetPatterns.join("\n")}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  releaseAssetPatterns: lines(event.target.value),
                })
              }
            />
          </Field>
          <div className="space-y-4">
            <Field
              label={t.secretNames || "必需的 GitHub Secret 名称"}
              hint={t.secretNamesHint || "只保存名称，不读取或备份 Secret 值。"}
            >
              <Textarea
                className="min-h-24 font-mono text-label-12"
                value={draft.requiredActionsSecretNames.join("\n")}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    requiredActionsSecretNames: lines(event.target.value),
                  })
                }
              />
            </Field>
            <Field
              label={t.secretEnvironment || "构建环境映射"}
              hint="每行 ENVIRONMENT=SECRET_NAME"
            >
              <Textarea
                className="min-h-24 font-mono text-label-12"
                value={secretEnvironmentText}
                onChange={(event) =>
                  setSecretEnvironmentText(event.target.value)
                }
              />
            </Field>
          </div>
        </section>

        <section className="space-y-4 border-t border-border pt-5">
          <div className="flex items-start justify-between gap-4 rounded-sm border border-warning/30 bg-warning/5 p-4">
            <div>
              <h3 className="text-label-14 font-semibold">
                {t.unsigned || "允许未验证的平台签名"}
              </h3>
              <p className="mt-1 text-label-12 text-muted-foreground">
                {t.unsignedHint ||
                  "启用后每次 GitHub 发布仍需再次确认；本地构建不会被标记为可分发。"}
              </p>
            </div>
            <Switch
              checked={draft.allowUnsignedRelease}
              onCheckedChange={(checked) =>
                setDraft({ ...draft, allowUnsignedRelease: checked })
              }
            />
          </div>
          <div className="flex items-start justify-between gap-4 rounded-sm border border-border p-4">
            <div>
              <h3 className="text-label-14 font-semibold">Tauri Updater</h3>
              <p className="mt-1 text-label-12 text-muted-foreground">
                {t.updaterHint ||
                  "启用后，签名和 latest.json 缺失都会阻断 Release；私有仓库不支持 Updater。"}
              </p>
            </div>
            <Switch
              checked={draft.updater.enabled}
              onCheckedChange={(checked) =>
                setDraft({
                  ...draft,
                  updater: { ...draft.updater, enabled: checked },
                })
              }
            />
          </div>
          {draft.updater.enabled ? (
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t.updaterEndpoint || "Updater endpoint"}>
                <Input
                  value={draft.updater.endpoint ?? ""}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      updater: {
                        ...draft.updater,
                        endpoint: event.target.value || null,
                      },
                    })
                  }
                />
              </Field>
              <Field label={t.updaterSecret || "Updater 私钥 Secret 名称"}>
                <Input
                  value={draft.updater.privateKeySecretName ?? ""}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      updater: {
                        ...draft.updater,
                        privateKeySecretName: event.target.value || null,
                      },
                    })
                  }
                />
              </Field>
              <Field label={t.updaterPublicKey || "Updater 公钥"}>
                <Textarea
                  className="min-h-24 font-mono text-label-12"
                  value={draft.updater.publicKey ?? ""}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      updater: {
                        ...draft.updater,
                        publicKey: event.target.value || null,
                      },
                    })
                  }
                />
              </Field>
              <AppDialogInset className="p-4 text-label-12 text-muted-foreground">
                {selectedApp?.updaterEnabled
                  ? t.updaterDetected ||
                    "项目当前已启用 updater artifacts。受管 workflow 仍会注入一致的临时配置。"
                  : t.updaterInjected ||
                    "项目当前未启用 updater artifacts。受管 workflow 会在构建时注入临时配置，不改仓库文件。"}
              </AppDialogInset>
            </div>
          ) : null}
        </section>

        <section className="space-y-4 border-t border-border pt-5">
          <Field
            label={t.gates || "结构化发布门禁"}
            hint={'JSON 数组，例如 [{"program":"pnpm","args":["typecheck"]}]'}
          >
            <Textarea
              className="min-h-28 font-mono text-label-12"
              value={gatesText}
              onChange={(event) => setGatesText(event.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button onClick={saveConfig} disabled={action !== null}>
              {action === "save" ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Save className="mr-2 size-4" />
              )}
              {t.save || "保存本地配置"}
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                runAction("export", async () => {
                  const path = await saveDialog({
                    defaultPath: `${repository.name}-tauri-release.json`,
                    filters: [{ name: "JSON", extensions: ["json"] }],
                  });
                  if (path) await exportTauriReleaseConfig(repository.id, path);
                })
              }
              disabled={!config || action !== null}
            >
              <Download className="mr-2 size-4" />
              {t.export || "导出备份"}
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                runAction("import", async () => {
                  const path = await openDialog({
                    multiple: false,
                    filters: [{ name: "JSON", extensions: ["json"] }],
                  });
                  if (typeof path === "string") {
                    applyLoadedConfig(
                      await importTauriReleaseConfig(repository.id, path)
                    );
                    setWorkflow(
                      await previewTauriManagedWorkflow(repository.id)
                    );
                  }
                })
              }
              disabled={action !== null}
            >
              <Upload className="mr-2 size-4" />
              {t.import || "导入备份"}
            </Button>
          </div>
        </section>

        {workflow ? (
          <section className="space-y-3 border-t border-border pt-5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="mr-auto text-label-14 font-semibold">
                {t.workflow || "受管 GitHub workflow"}
              </h3>
              <AppDialogBadge
                variant={
                  workflow.status === "current" &&
                  workflow.conflicts.length === 0
                    ? "success"
                    : "warning"
                }
              >
                {workflow.status}
              </AppDialogBadge>
            </div>
            {workflow.conflicts.length > 0 ? (
              <AppDialogInset className="p-4 text-label-12">
                <p className="font-semibold text-warning">
                  {t.conflicts || "接管时将删除这些冲突的发布 workflow："}
                </p>
                {workflow.conflicts.map((conflict) => (
                  <p key={conflict.path} className="mt-1 font-mono">
                    {conflict.path}
                  </p>
                ))}
              </AppDialogInset>
            ) : null}
            {workflow.status !== "current" || workflow.conflicts.length > 0 ? (
              <>
                <details className="rounded-sm border border-border p-3">
                  <summary className="cursor-pointer text-label-13 font-semibold">
                    {t.workflowDiff || "查看完整接管差异"}
                  </summary>
                  <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap text-label-12">
                    {workflow.diff}
                  </pre>
                </details>
                <label className="flex items-start gap-2 text-label-13">
                  <input
                    type="checkbox"
                    checked={takeoverConfirmed}
                    onChange={(event) =>
                      setTakeoverConfirmed(event.target.checked)
                    }
                  />
                  <span>
                    {t.takeoverConfirm ||
                      "我确认 One Publish 将在默认分支提交受管 workflow、删除上列冲突文件并直接推送。"}
                  </span>
                </label>
                <Button
                  variant="destructive"
                  disabled={!takeoverConfirmed || action !== null}
                  onClick={() =>
                    runAction("takeover", async () => {
                      await applyTauriWorkflowTakeover(
                        repository.id,
                        workflow.previewId
                      );
                      setWorkflow(
                        await previewTauriManagedWorkflow(repository.id)
                      );
                      setTakeoverConfirmed(false);
                      toast.success(
                        t.takeoverDone || "受管 workflow 已提交并推送"
                      );
                    })
                  }
                >
                  {action === "takeover" ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <CloudUpload className="mr-2 size-4" />
                  )}
                  {t.takeover || "接管 workflow"}
                </Button>
              </>
            ) : (
              <p className="text-label-13 text-success">
                {t.workflowCurrent ||
                  "受管 workflow 与本地配置一致，可以进行 GitHub 发布预检。"}
              </p>
            )}
          </section>
        ) : (
          <AppDialogInset className="p-4 text-label-13 text-muted-foreground">
            {t.saveBeforeWorkflow || "先保存配置，再生成并预览受管 workflow。"}
          </AppDialogInset>
        )}
      </div>
    );
  };

  const renderLocal = () => (
    <div className="space-y-5">
      <AppDialogInset className="p-4">
        <h3 className="text-label-14 font-semibold">
          {t.localTitle || "当前机器本地交付"}
        </h3>
        <p className="mt-1 text-label-13 text-muted-foreground">
          {t.localHint ||
            "允许脏工作区，只构建当前操作系统；产物复制到按应用、版本、平台和时间隔离的目录。"}
        </p>
      </AppDialogInset>
      <div className="grid gap-3 md:grid-cols-3">
        <AppDialogInset className="p-4">
          <p className="text-label-12 text-muted-foreground">
            {t.platformSigning || "平台代码签名"}
          </p>
          <p className="mt-1 text-label-14 font-semibold">
            {localResult?.platformSigning ?? "pending"}
          </p>
        </AppDialogInset>
        <AppDialogInset className="p-4">
          <p className="text-label-12 text-muted-foreground">
            {t.updaterSigning || "Updater signing"}
          </p>
          <p className="mt-1 text-label-14 font-semibold">
            {config?.updater.enabled ? "GitHub workflow" : "disabled"}
          </p>
        </AppDialogInset>
        <AppDialogInset className="p-4">
          <p className="text-label-12 text-muted-foreground">
            {t.detachedSigning || "Detached artifact signing"}
          </p>
          <p className="mt-1 text-label-14 font-semibold">
            {t.detachedSeparate || "Separate flow"}
          </p>
        </AppDialogInset>
      </div>
      <Button
        disabled={!config || action !== null}
        onClick={() =>
          runAction("local", async () => {
            const result = await executeTauriLocalBuild(repository.id);
            setLocalResult(result);
            if (result.publish.success)
              toast.success(t.localDone || "本地 Tauri 产物已交付", {
                description: result.deliveryDir,
              });
          })
        }
      >
        {action === "local" ? (
          <Loader2 className="mr-2 size-4 animate-spin" />
        ) : (
          <FolderOutput className="mr-2 size-4" />
        )}
        {t.runLocal || "构建并交付到本地"}
      </Button>
      {localResult ? (
        <section className="space-y-3 rounded-sm border border-border p-4">
          <div className="flex flex-wrap items-center gap-2">
            {localResult.publish.success ? (
              <CheckCircle2 className="size-4 text-success" />
            ) : (
              <XCircle className="size-4 text-destructive" />
            )}
            <span className="text-label-14 font-semibold">
              {localResult.publish.success
                ? t.buildSuccess || "构建成功"
                : t.buildFailed || "构建失败"}
            </span>
            {localResult.worktreeDirty ? (
              <AppDialogBadge variant="warning">
                non-reproducible
              </AppDialogBadge>
            ) : (
              <AppDialogBadge variant="success">reproducible</AppDialogBadge>
            )}
          </div>
          {localResult.deliveryDir ? (
            <p className="break-all font-mono text-label-12">
              {localResult.deliveryDir}
            </p>
          ) : null}
          {localResult.publish.error ? (
            <p className="whitespace-pre-wrap text-label-12 text-destructive">
              {localResult.publish.error}
            </p>
          ) : null}
          {localResult.deliveryDir ? (
            <Button
              variant="outline"
              onClick={() =>
                runAction("open-local", async () => {
                  await openOutputDirectory(localResult.deliveryDir);
                })
              }
            >
              {t.openDirectory || "打开交付目录"}
            </Button>
          ) : null}
        </section>
      ) : null}
    </div>
  );

  const renderAttempt = (attempt: ReleaseAttempt) => (
    <section
      className="space-y-3 rounded-sm border border-border p-4"
      key={attempt.id}
    >
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-label-14">{attempt.tag}</strong>
        <AppDialogBadge variant={stageTone(attempt.stage)}>
          {attempt.stage}
        </AppDialogBadge>
        <span className="ml-auto text-label-12 text-muted-foreground">
          {attempt.updatedAt}
        </span>
      </div>
      <div className="grid gap-2 text-label-12 md:grid-cols-2">
        <p>
          {t.platformSigning || "平台代码签名"}: {attempt.signingSummary}
        </p>
        <p>Updater: {attempt.updaterSummary}</p>
      </div>
      {attempt.retryReason ? (
        <p className="whitespace-pre-wrap text-label-12 text-destructive">
          {attempt.retryReason}
        </p>
      ) : null}
      {attempt.releaseAssetNames.length > 0 ? (
        <p className="break-words font-mono text-label-12 text-muted-foreground">
          {attempt.releaseAssetNames.join(", ")}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {attempt.stage === "monitoring_workflow" ? (
          <Button
            variant="outline"
            onClick={() =>
              runAction("refresh", async () => {
                const refreshed = await refreshTauriReleaseAttempt(attempt.id);
                setAttempts((current) =>
                  current.map((item) =>
                    item.id === refreshed.id ? refreshed : item
                  )
                );
              })
            }
          >
            <RefreshCw className="mr-2 size-4" />
            {t.refresh || "刷新"}
          </Button>
        ) : null}
        {ACTIVE_STAGES.has(attempt.stage) ? (
          <Button
            variant="outline"
            onClick={() =>
              runAction("cancel", async () => {
                const cancelled = await cancelTauriReleaseAttempt(attempt.id);
                setAttempts((current) =>
                  current.map((item) =>
                    item.id === cancelled.id ? cancelled : item
                  )
                );
              })
            }
          >
            {t.cancel || "取消"}
          </Button>
        ) : null}
        {attempt.stage === "failed" && attempt.workflowRunId ? (
          <Button
            variant="outline"
            onClick={() =>
              runAction("retry", async () => {
                const retried = await retryTauriReleaseAttempt(attempt.id);
                setAttempts((current) =>
                  current.map((item) =>
                    item.id === retried.id ? retried : item
                  )
                );
              })
            }
          >
            {t.retry || "重跑失败任务"}
          </Button>
        ) : null}
        {attempt.actionsUrl ? (
          <a
            className="inline-flex h-10 items-center rounded-sm border border-border px-4 text-label-13 hover:bg-gray-alpha-100"
            href={attempt.actionsUrl}
            target="_blank"
            rel="noreferrer"
          >
            GitHub Actions
          </a>
        ) : null}
        {attempt.releaseUrl ? (
          <a
            className="inline-flex h-10 items-center rounded-sm border border-border px-4 text-label-13 hover:bg-gray-alpha-100"
            href={attempt.releaseUrl}
            target="_blank"
            rel="noreferrer"
          >
            GitHub Release
          </a>
        ) : null}
      </div>
    </section>
  );

  const renderGithub = () => (
    <div className="space-y-5">
      {monitorError ? (
        <AppDialogInset className="flex items-start gap-3 border-destructive/30 bg-destructive/5 p-4">
          <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <p className="whitespace-pre-wrap text-label-12 text-destructive">
            {monitorError}
          </p>
        </AppDialogInset>
      ) : null}
      {workflow?.status !== "current" || workflow.conflicts.length > 0 ? (
        <AppDialogInset className="flex items-start gap-3 border-warning/30 bg-warning/5 p-4">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <p className="text-label-13">
            {t.workflowBlocked ||
              "GitHub 发布已阻断：请先在“配置与 workflow”完成接管并消除漂移。"}
          </p>
        </AppDialogInset>
      ) : null}
      <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
        <Field
          label={t.nextVersion || "下一个稳定版本"}
          hint={
            selectedApp
              ? `${t.currentVersion || "当前版本"}: ${selectedApp.versionSource.version}`
              : undefined
          }
        >
          <Input
            value={version}
            onChange={(event) => {
              setVersion(event.target.value);
              setPreflight(null);
            }}
            placeholder="0.9.0"
          />
        </Field>
        <Button
          variant="outline"
          disabled={
            !config ||
            workflow?.status !== "current" ||
            workflow.conflicts.length > 0 ||
            action !== null ||
            Boolean(activeAttempt)
          }
          onClick={() =>
            runAction("preflight", async () => {
              const result = await prepareTauriGithubRelease(
                repository.id,
                version
              );
              setPreflight(result);
              setReleaseNotes(result.releaseNotes);
            })
          }
        >
          {action === "preflight" ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <Settings2 className="mr-2 size-4" />
          )}
          {t.preflight || "运行发布预检"}
        </Button>
      </div>
      {preflight ? (
        <section className="space-y-4 rounded-sm border border-border p-4">
          <div className="flex flex-wrap gap-2">
            <AppDialogBadge variant="success">
              {preflight.repositoryIdentity.nameWithOwner}
            </AppDialogBadge>
            <AppDialogBadge variant="neutral">
              {preflight.repositoryIdentity.visibility}
            </AppDialogBadge>
            <AppDialogBadge variant="neutral">
              {preflight.currentBranch}
            </AppDialogBadge>
            <AppDialogBadge variant="success">{preflight.tag}</AppDialogBadge>
          </div>
          {preflight.warnings.map((warning) => (
            <p key={warning} className="flex gap-2 text-label-12 text-warning">
              <AlertTriangle className="size-4 shrink-0" />
              {warning}
            </p>
          ))}
          <Field label={t.releaseNotes || "Release Notes"}>
            <Textarea
              className="min-h-52 font-mono text-label-12"
              value={releaseNotes}
              onChange={(event) => setReleaseNotes(event.target.value)}
            />
          </Field>
          {config?.allowUnsignedRelease ? (
            <label className="flex items-start gap-2 rounded-sm border border-warning/30 bg-warning/5 p-3 text-label-13">
              <input
                type="checkbox"
                checked={unsignedConfirmed}
                onChange={(event) => setUnsignedConfirmed(event.target.checked)}
              />
              <span>
                {t.unsignedConfirm ||
                  "我确认本仓库允许未验证的平台代码签名，并接受本次发布风险。"}
              </span>
            </label>
          ) : null}
          <Button
            disabled={
              action !== null ||
              Boolean(activeAttempt) ||
              !releaseNotes.trim() ||
              Boolean(config?.allowUnsignedRelease && !unsignedConfirmed)
            }
            onClick={() =>
              runAction("release", async () => {
                const attempt = await startTauriGithubRelease({
                  repositoryId: repository.id,
                  preflightId: preflight.preflightId,
                  version: preflight.version,
                  releaseNotes,
                  confirmUnsignedRelease: unsignedConfirmed,
                });
                setAttempts((current) => [
                  attempt,
                  ...current.filter((item) => item.id !== attempt.id),
                ]);
                setPreflight(null);
              })
            }
          >
            {action === "release" ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Github className="mr-2 size-4" />
            )}
            {t.publishGithub || "提交、打 Tag 并发布到 GitHub"}
          </Button>
          <p className="text-label-12 text-muted-foreground">
            {t.transactionHint ||
              "One Publish 只提交版本文件、Release Notes 与门禁允许的变更，并原子推送默认分支和不可变 Tag。"}
          </p>
        </section>
      ) : null}
      <section className="space-y-3">
        <h3 className="text-label-14 font-semibold">
          {t.attempts || "发布尝试"}
        </h3>
        {latestAttempt ? (
          attempts.slice(0, 5).map(renderAttempt)
        ) : (
          <AppDialogInset className="p-4 text-label-13 text-muted-foreground">
            {t.noAttempts || "暂无 GitHub 发布尝试。"}
          </AppDialogInset>
        )}
      </section>
    </div>
  );

  const tabs: Array<{ id: ReleaseTab; label: string; icon: React.ReactNode }> =
    [
      {
        id: "config",
        label: t.configTab || "配置与 workflow",
        icon: <FileCode2 className="size-4" />,
      },
      {
        id: "local",
        label: t.localTab || "本地交付",
        icon: <FolderOutput className="size-4" />,
      },
      {
        id: "github",
        label: t.githubTab || "GitHub 发布",
        icon: <Github className="size-4" />,
      },
    ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AppDialogShell
        size="responsive"
        title={t.title || "Tauri 发布中心"}
        description={`${repository.name} · ${repository.path}`}
        icon={<Github className="size-4" />}
        bodyPadding="none"
        bodyScrollable={false}
        footer={
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t.close || "关闭"}
          </Button>
        }
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-wrap gap-1 border-b border-border p-3">
            {tabs.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => setTab(item.id)}
                className={cn(
                  "flex items-center gap-2 rounded-sm px-3 py-2 text-label-13 transition-colors",
                  tab === item.id
                    ? "bg-interactive/10 text-interactive"
                    : "text-muted-foreground hover:bg-gray-alpha-100"
                )}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
            <AppDialogBadge variant="neutral" className="ml-auto">
              Tauri 2
            </AppDialogBadge>
          </div>
          <div className="geist-scrollbar min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
            {loading ? (
              <div className="flex min-h-64 items-center justify-center gap-2 text-label-13 text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                {t.loading || "加载中…"}
              </div>
            ) : tab === "config" ? (
              renderConfig()
            ) : tab === "local" ? (
              renderLocal()
            ) : (
              renderGithub()
            )}
          </div>
        </div>
      </AppDialogShell>
    </Dialog>
  );
}
