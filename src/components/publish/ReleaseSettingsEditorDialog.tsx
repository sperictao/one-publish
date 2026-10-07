import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Hammer,
  KeyRound,
  ListChecks,
  Loader2,
  Plus,
  RefreshCw,
  Rocket,
  Save,
  SlidersHorizontal,
  X,
} from "lucide-react";

import { Dialog } from "@/components/ui/dialog";
import { AppDialogShell } from "@/components/ui/app-dialog-shell";
import { AppDialogInset } from "@/components/ui/app-dialog-inset";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { SectionShell } from "@/components/ui/section-shell";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrayParameter } from "@/components/publish/ArrayParameter";
import { MapParameter } from "@/components/publish/MapParameter";
import {
  loadReleaseSettingsDraft,
  updateProfileReleaseSettings,
} from "@/lib/store/api";
import type { ConfigProfile } from "@/lib/store/types";
import type {
  ReleaseGate,
  TauriBuildDriver,
  TauriDesktopTarget,
  TauriReleaseConfig,
  TauriUpdaterSettings,
  VersionMirror,
  VersionMirrorKind,
} from "@/generated/tauri-contracts";
import type { ParameterDefinition } from "@/types/parameters";
import { useI18n } from "@/hooks/useI18n";
import { localizeInvokeError } from "@/lib/tauri/invokeErrors";

const BUILD_DRIVERS: TauriBuildDriver[] = [
  "pnpm",
  "npm",
  "yarn",
  "bun",
  "cargo",
];

const DESKTOP_TARGETS: Array<{ id: TauriDesktopTarget; label: string }> = [
  { id: "windows_x64", label: "Windows x64" },
  { id: "linux_x64", label: "Linux x64" },
  { id: "macos_x64", label: "macOS x64" },
  { id: "macos_arm64", label: "macOS arm64" },
  { id: "macos_universal", label: "macOS Universal" },
];

const MIRROR_KINDS: VersionMirrorKind[] = [
  "json_pointer",
  "toml_key",
  "cargo_lock_package",
];

/** 复用参数编辑器的列表与映射控件；它们只读取 description 与 label。 */
const LIST_DEFINITION: ParameterDefinition = { type: "array", flag: "" };
const MAP_DEFINITION: ParameterDefinition = { type: "map", flag: "" };

type DraftPatch =
  | Partial<TauriReleaseConfig>
  | ((current: TauriReleaseConfig) => Partial<TauriReleaseConfig>);

/** 按位置合并一行编辑；门禁与版本镜像没有稳定身份。 */
const patchAt = <T,>(items: T[], index: number, patch: Partial<T>): T[] =>
  items.map((item, itemIndex) =>
    itemIndex === index ? { ...item, ...patch } : item
  );

const blankToNull = (value: string | null) => {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
};

const cleanList = (items: string[]) =>
  items.map((item) => item.trim()).filter((item) => item !== "");

/**
 * 提交前只做呈现层整理（去空白、丢弃空行）；合法性由后端
 * validate_release_config 判定，前端不复制校验规则（ADR-0060）。
 */
function normalizeReleaseSettings(
  settings: TauriReleaseConfig
): TauriReleaseConfig {
  return {
    ...settings,
    appConfigPath: settings.appConfigPath.trim(),
    appName: settings.appName.trim(),
    localDeliveryDir: settings.localDeliveryDir.trim(),
    tagPrefix: settings.tagPrefix.trim(),
    releaseAssetPatterns: cleanList(settings.releaseAssetPatterns),
    requiredActionsSecretNames: cleanList(settings.requiredActionsSecretNames),
    actionsSecretEnvironment: Object.fromEntries(
      Object.entries(settings.actionsSecretEnvironment)
        .map(([environment, secret]) => [environment.trim(), secret.trim()])
        .filter(([environment, secret]) => environment !== "" || secret !== "")
    ),
    updater: {
      enabled: settings.updater.enabled,
      endpoint: blankToNull(settings.updater.endpoint),
      publicKey: blankToNull(settings.updater.publicKey),
      privateKeySecretName: blankToNull(settings.updater.privateKeySecretName),
    },
    releaseGates: settings.releaseGates
      .map((gate) => ({
        program: gate.program.trim(),
        args: cleanList(gate.args),
      }))
      .filter((gate) => gate.program !== "" || gate.args.length > 0),
    versionMirrors: settings.versionMirrors
      .map((mirror) => ({
        ...mirror,
        path: mirror.path.trim(),
        selector: mirror.selector.trim(),
      }))
      .filter((mirror) => mirror.path !== "" || mirror.selector !== ""),
  };
}

interface ReleaseSettingsEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoId: string;
  profile: ConfigProfile;
  /** 保存成功后刷新配置列表，让新修订进入绑定判定。 */
  onSaved: () => void;
}

/**
 * Tauri 发布设置的过渡期专用表单（ADR-0060）：编辑修订保留键
 * `releaseSettings`，保存经后端校验后产生新修订。schema 驱动编辑器
 * （ADR-0030）能表达这些设置后删除。
 */
export function ReleaseSettingsEditorDialog({
  open,
  onOpenChange,
  repoId,
  profile,
  onSaved,
}: ReleaseSettingsEditorDialogProps) {
  const { translations } = useI18n();
  const t = translations.releaseSettings || {};
  const commonT = translations.common || {};
  // 加载失败只在回调时读取最新翻译；不进入 effect 依赖，避免翻译加载完成时重新加载草稿。
  const translationsRef = useRef(translations);
  useEffect(() => {
    translationsRef.current = translations;
  }, [translations]);

  const [draft, setDraft] = useState<TauriReleaseConfig | null>(null);
  const [stored, setStored] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // 调用方按配置挂载新实例（key），表单状态不在 effect 中重置。
  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    void loadReleaseSettingsDraft({ repoId, profileId: profile.id })
      .then((result) => {
        if (!cancelled) {
          setDraft(result.settings);
          setStored(result.stored);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(localizeInvokeError(error, translationsRef.current));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, repoId, profile.id]);

  const update = (patch: DraftPatch) =>
    setDraft((current) =>
      current
        ? {
            ...current,
            ...(typeof patch === "function" ? patch(current) : patch),
          }
        : current
    );
  const updateUpdater = (patch: Partial<TauriUpdaterSettings>) =>
    update((current) => ({ updater: { ...current.updater, ...patch } }));
  const updateGate = (index: number, patch: Partial<ReleaseGate>) =>
    update((current) => ({
      releaseGates: patchAt(current.releaseGates, index, patch),
    }));
  const updateMirror = (index: number, patch: Partial<VersionMirror>) =>
    update((current) => ({
      versionMirrors: patchAt(current.versionMirrors, index, patch),
    }));

  const handleSave = async () => {
    if (!draft) {
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    try {
      await updateProfileReleaseSettings({
        repoId,
        profileId: profile.id,
        settings: normalizeReleaseSettings(draft),
      });
      toast.success(t.saveSuccess || "发布设置已保存为新修订");
      onSaved();
      onOpenChange(false);
    } catch (error) {
      // 校验失败在表单内显式呈现，保存前不产生修订。
      setSaveError(localizeInvokeError(error, translations));
    } finally {
      setIsSaving(false);
    }
  };

  const textField = (
    id: string,
    label: string,
    value: string,
    onChange: (value: string) => void,
    placeholder?: string
  ) => (
    <div className="space-y-1">
      <Label className="text-label-12" htmlFor={id}>
        {label}
      </Label>
      <Input
        id={id}
        className="h-8 text-label-12"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );

  // 初值不是修订已保存的设置时提示：要么修订还没有设置，要么已有值无法读取。
  let draftNotice: string | null = null;
  if (!stored) {
    draftNotice =
      profile.parameters.releaseSettings == null
        ? t.draftSuggested ||
          "该配置尚未保存发布设置。以下初值来自默认值与项目探测，保存后才会写入新修订。"
        : t.draftUnreadable ||
          "当前修订中的发布设置无法读取，以下初值来自默认值与项目探测；保存后将替换。";
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AppDialogShell
        size="workspace"
        title={(t.title || "发布设置：{{name}}").replace(
          "{{name}}",
          profile.name
        )}
        description={
          t.description ||
          "编辑 Tauri 配置的发布期设置；保存前经后端校验，并产生一版新修订。"
        }
        icon={<SlidersHorizontal className="size-4" />}
        bodyInnerClassName="space-y-4"
        footer={
          <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              {commonT.cancel || "取消"}
            </Button>
            <Button
              type="button"
              onClick={() => void handleSave()}
              disabled={isSaving || !draft}
              data-testid="release-settings-save"
            >
              {isSaving ? (
                <>
                  <span className="mr-2 inline-block animate-spin">
                    <Loader2 className="size-4" />
                  </span>
                  {t.saving || "保存中…"}
                </>
              ) : (
                <>
                  <Save className="mr-2 size-4" />
                  {t.saveAction || "保存为新修订"}
                </>
              )}
            </Button>
          </div>
        }
      >
        {saveError ? (
          <div
            className="rounded-sm border border-destructive/40 bg-destructive/10 px-3 py-2 text-label-12 text-destructive"
            role="alert"
            data-testid="release-settings-error"
          >
            <p className="font-semibold">{t.saveFailed || "发布设置未保存"}</p>
            <p className="mt-0.5 break-words">{saveError}</p>
          </div>
        ) : null}

        {draft === null ? (
          <AppDialogInset className="px-4 py-6 text-label-12 text-muted-foreground">
            {loadError
              ? `${t.loadFailed || "加载发布设置失败"}: ${loadError}`
              : t.loading || "正在加载发布设置…"}
          </AppDialogInset>
        ) : (
          <>
            {draftNotice ? (
              <div
                className="rounded-sm border border-amber-600/40 bg-amber-500/10 px-3 py-2 text-label-12 text-amber-700 dark:text-amber-400"
                data-testid="release-settings-draft-notice"
              >
                {draftNotice}
              </div>
            ) : null}

            <SectionShell
              icon={Hammer}
              title={t.buildTitle || "构建"}
              description={
                t.buildDescription ||
                "Tauri 配置入口、构建驱动与要发布的桌面目标。"
              }
            >
              <div className="grid gap-3 md:grid-cols-2">
                {textField(
                  "release-settings-app-config-path",
                  t.appConfigPath || "配置文件路径",
                  draft.appConfigPath,
                  (appConfigPath) => update({ appConfigPath }),
                  "src-tauri/tauri.conf.json"
                )}
                {textField(
                  "release-settings-app-name",
                  t.appName || "应用名称",
                  draft.appName,
                  (appName) => update({ appName })
                )}
                <div className="space-y-1">
                  <Label
                    className="text-label-12"
                    htmlFor="release-settings-build-driver"
                  >
                    {t.buildDriver || "构建驱动"}
                  </Label>
                  <Select
                    value={draft.buildDriver}
                    onValueChange={(buildDriver) =>
                      update({ buildDriver: buildDriver as TauriBuildDriver })
                    }
                  >
                    <SelectTrigger
                      id="release-settings-build-driver"
                      className="h-8 text-label-12"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BUILD_DRIVERS.map((driver) => (
                        <SelectItem
                          key={driver}
                          value={driver}
                          className="text-label-12"
                        >
                          {driver}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {textField(
                  "release-settings-local-delivery-dir",
                  t.localDeliveryDir || "本地交付目录",
                  draft.localDeliveryDir,
                  (localDeliveryDir) => update({ localDeliveryDir }),
                  "dist/one-publish"
                )}
              </div>
              <fieldset className="mt-3 space-y-2">
                <legend className="text-label-12 font-medium">
                  {t.enabledTargets || "桌面目标"}
                </legend>
                <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
                  {DESKTOP_TARGETS.map((target) => (
                    <div
                      key={target.id}
                      className="flex items-center justify-between gap-3 rounded-sm border border-border px-3 py-1.5"
                    >
                      <span className="text-label-12">{target.label}</span>
                      <Switch
                        checked={draft.enabledTargets.includes(target.id)}
                        aria-label={target.label}
                        onCheckedChange={(checked) =>
                          update({
                            enabledTargets: DESKTOP_TARGETS.map(
                              (candidate) => candidate.id
                            ).filter((id) =>
                              id === target.id
                                ? checked
                                : draft.enabledTargets.includes(id)
                            ),
                          })
                        }
                      />
                    </div>
                  ))}
                </div>
              </fieldset>
            </SectionShell>

            <SectionShell
              icon={Rocket}
              title={t.releaseTitle || "发布"}
              description={
                t.releaseDescription || "版本标签前缀与允许上传的发布资产。"
              }
            >
              <div className="grid gap-3 md:grid-cols-2">
                {textField(
                  "release-settings-tag-prefix",
                  t.tagPrefix || "标签前缀",
                  draft.tagPrefix,
                  (tagPrefix) => update({ tagPrefix }),
                  "v"
                )}
              </div>
              <ArrayParameter
                definition={LIST_DEFINITION}
                label={t.releaseAssetPatterns || "发布资产文件名模式"}
                value={draft.releaseAssetPatterns}
                onChange={(items) =>
                  update({ releaseAssetPatterns: items.map(String) })
                }
              />
            </SectionShell>

            <SectionShell
              icon={KeyRound}
              title={t.signingTitle || "签名与 Secret"}
              description={
                t.signingDescription ||
                "只保存 GitHub Actions Secret 的名称，不保存值；配置备份不包含这些名称，导入后需在此补齐。"
              }
            >
              <div className="space-y-1 rounded-sm border border-border px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <Label
                    className="text-label-12"
                    htmlFor="release-settings-allow-unsigned"
                  >
                    {t.allowUnsignedRelease || "授权未签名发布"}
                  </Label>
                  <Switch
                    id="release-settings-allow-unsigned"
                    checked={draft.allowUnsignedRelease}
                    onCheckedChange={(allowUnsignedRelease) =>
                      update({ allowUnsignedRelease })
                    }
                  />
                </div>
                <p className="text-label-12 text-muted-foreground">
                  {t.allowUnsignedReleaseHint ||
                    "启用 Windows 或 macOS 目标时，需要填写签名环境变量映射，或显式授权未签名发布。"}
                </p>
              </div>
              <MapParameter
                definition={MAP_DEFINITION}
                label={
                  t.actionsSecretEnvironment || "签名环境变量 → Secret 名称"
                }
                value={draft.actionsSecretEnvironment}
                onChange={(entries) =>
                  update({
                    actionsSecretEnvironment: Object.fromEntries(
                      Object.entries(entries).map(([key, value]) => [
                        key,
                        String(value),
                      ])
                    ),
                  })
                }
              />
              <ArrayParameter
                definition={LIST_DEFINITION}
                label={t.requiredActionsSecretNames || "必需的 Secret 名称"}
                value={draft.requiredActionsSecretNames}
                onChange={(items) =>
                  update({ requiredActionsSecretNames: items.map(String) })
                }
              />
            </SectionShell>

            <SectionShell
              icon={RefreshCw}
              title={t.updaterTitle || "Updater"}
              description={
                t.updaterDescription ||
                "启用后 Updater 签名是硬性条件：端点、公钥与私钥 Secret 名称缺一不可。"
              }
            >
              <div className="flex items-center justify-between gap-3">
                <Label
                  className="text-label-12"
                  htmlFor="release-settings-updater-enabled"
                >
                  {t.updaterEnabled || "启用 Tauri Updater"}
                </Label>
                <Switch
                  id="release-settings-updater-enabled"
                  checked={draft.updater.enabled}
                  onCheckedChange={(enabled) => updateUpdater({ enabled })}
                />
              </div>
              {draft.updater.enabled ? (
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {textField(
                    "release-settings-updater-endpoint",
                    t.updaterEndpoint || "更新端点（HTTPS）",
                    draft.updater.endpoint ?? "",
                    (endpoint) => updateUpdater({ endpoint }),
                    "https://example.com/latest.json"
                  )}
                  {textField(
                    "release-settings-updater-secret",
                    t.updaterPrivateKeySecretName || "私钥 Secret 名称",
                    draft.updater.privateKeySecretName ?? "",
                    (privateKeySecretName) =>
                      updateUpdater({ privateKeySecretName }),
                    "TAURI_SIGNING_PRIVATE_KEY"
                  )}
                  <div className="space-y-1 md:col-span-2">
                    <Label
                      className="text-label-12"
                      htmlFor="release-settings-updater-public-key"
                    >
                      {t.updaterPublicKey || "Updater 公钥"}
                    </Label>
                    <Textarea
                      id="release-settings-updater-public-key"
                      className="min-h-[56px] text-label-12"
                      value={draft.updater.publicKey ?? ""}
                      onChange={(event) =>
                        updateUpdater({ publicKey: event.target.value })
                      }
                    />
                  </div>
                </div>
              ) : null}
            </SectionShell>

            <SectionShell
              icon={ListChecks}
              title={t.gatesTitle || "门禁与版本镜像"}
              description={
                t.gatesDescription ||
                "发布前运行的结构化门禁程序，以及需要与权威版本保持一致的其他版本字段。"
              }
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-label-12">
                    {t.releaseGates || "发布门禁"}
                  </Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      update({
                        releaseGates: [
                          ...draft.releaseGates,
                          { program: "", args: [] },
                        ],
                      })
                    }
                  >
                    <Plus className="mr-1 size-4" />
                    {t.addGate || "添加门禁"}
                  </Button>
                </div>
                {draft.releaseGates.map((gate, index) => (
                  <div
                    // 门禁没有稳定身份，按位置编辑；删除只影响其后的行。
                    key={`gate-${index}`}
                    className="grid gap-2 rounded-sm border border-border p-2 md:grid-cols-[1fr_2fr_auto]"
                  >
                    <Input
                      className="h-8 text-label-12"
                      value={gate.program}
                      placeholder="pnpm"
                      aria-label={`${t.gateProgram || "程序"} ${index + 1}`}
                      onChange={(event) =>
                        updateGate(index, { program: event.target.value })
                      }
                    />
                    <Textarea
                      className="min-h-[32px] text-label-12"
                      rows={2}
                      value={gate.args.join("\n")}
                      placeholder={"test\n--run"}
                      aria-label={`${t.gateArgs || "参数（每行一个）"} ${index + 1}`}
                      onChange={(event) =>
                        updateGate(index, {
                          args: event.target.value.split("\n"),
                        })
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={(
                        t.removeGate || "移除门禁 {{index}}"
                      ).replace("{{index}}", String(index + 1))}
                      onClick={() =>
                        update({
                          releaseGates: draft.releaseGates.filter(
                            (_, gateIndex) => gateIndex !== index
                          ),
                        })
                      }
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                ))}
                {draft.releaseGates.length === 0 ? (
                  <p className="text-label-12 text-muted-foreground">
                    {commonT.noEntriesAdded || "暂无条目"}
                  </p>
                ) : null}
              </div>

              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-label-12">
                    {t.versionMirrors || "版本镜像"}
                  </Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      update({
                        versionMirrors: [
                          ...draft.versionMirrors,
                          { path: "", kind: "json_pointer", selector: "" },
                        ],
                      })
                    }
                  >
                    <Plus className="mr-1 size-4" />
                    {t.addMirror || "添加版本镜像"}
                  </Button>
                </div>
                {draft.versionMirrors.map((mirror, index) => (
                  <div
                    key={`mirror-${index}`}
                    className="grid gap-2 rounded-sm border border-border p-2 md:grid-cols-[2fr_1fr_1fr_auto]"
                  >
                    <Input
                      className="h-8 text-label-12"
                      value={mirror.path}
                      placeholder="package.json"
                      aria-label={`${t.mirrorPath || "文件路径"} ${index + 1}`}
                      onChange={(event) =>
                        updateMirror(index, { path: event.target.value })
                      }
                    />
                    <Select
                      value={mirror.kind}
                      onValueChange={(kind) =>
                        updateMirror(index, { kind: kind as VersionMirrorKind })
                      }
                    >
                      <SelectTrigger
                        className="h-8 text-label-12"
                        aria-label={`${t.mirrorKind || "类型"} ${index + 1}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MIRROR_KINDS.map((kind) => (
                          <SelectItem
                            key={kind}
                            value={kind}
                            className="text-label-12"
                          >
                            {kind}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      className="h-8 text-label-12"
                      value={mirror.selector}
                      placeholder="/version"
                      aria-label={`${t.mirrorSelector || "选择子"} ${index + 1}`}
                      onChange={(event) =>
                        updateMirror(index, { selector: event.target.value })
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={(
                        t.removeMirror || "移除版本镜像 {{index}}"
                      ).replace("{{index}}", String(index + 1))}
                      onClick={() =>
                        update({
                          versionMirrors: draft.versionMirrors.filter(
                            (_, mirrorIndex) => mirrorIndex !== index
                          ),
                        })
                      }
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                ))}
                {draft.versionMirrors.length === 0 ? (
                  <p className="text-label-12 text-muted-foreground">
                    {commonT.noEntriesAdded || "暂无条目"}
                  </p>
                ) : null}
              </div>
            </SectionShell>
          </>
        )}
      </AppDialogShell>
    </Dialog>
  );
}
