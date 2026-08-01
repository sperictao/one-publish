import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  Boxes,
  ChevronDown,
  Layers3,
  Link2,
  Loader2,
  Plus,
  Route,
  Save,
  X,
} from "lucide-react";

import { Dialog } from "@/components/ui/dialog";
import { AppDialogShell } from "@/components/ui/app-dialog-shell";
import { AppDialogInset } from "@/components/ui/app-dialog-inset";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SectionShell } from "@/components/ui/section-shell";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { listPublishAdapterCatalog } from "@/lib/store/api";
import type { ConfigProfile } from "@/lib/store/types";
import type {
  JsonValue,
  PublishAdapterCatalog,
  PublishComposition,
  RevisionAdapterBinding,
  RevisionDeliveryRoute,
} from "@/generated/tauri-contracts";
import { useI18n } from "@/hooks/useI18n";

/** 凭据填的是引用（`<scheme>:<定位>`），不是秘密值；引用的含义由凭据来源决定。 */
const CREDENTIAL_REFERENCE_PATTERN = /^[a-z][a-z0-9+.-]*:\S+$/i;

type FieldKind = "string" | "number" | "boolean" | "stringList";

interface DestinationField {
  key: string;
  label: string;
  kind: FieldKind;
  placeholder?: string;
}

/**
 * 各 Destination 的非秘密设置字段与凭据要求，与 publish-adapters 中的
 * AdapterSchema 声明一一对应；这是呈现层描述，可用性以后端目录为准。
 */
const DESTINATION_FIELDS: Record<string, DestinationField[]> = {
  "local-directory": [],
  sftp: [
    {
      key: "host",
      label: "host",
      kind: "string",
      placeholder: "mirror.example.com",
    },
    { key: "port", label: "port", kind: "number", placeholder: "22" },
    {
      key: "username",
      label: "username",
      kind: "string",
      placeholder: "publisher",
    },
    {
      key: "remote_path",
      label: "remote_path",
      kind: "string",
      placeholder: "/srv/releases",
    },
    {
      key: "artifact_roles",
      label: "artifact_roles",
      kind: "stringList",
      placeholder: "provider-output:*",
    },
  ],
  "github-release": [
    {
      key: "repository",
      label: "repository",
      kind: "string",
      placeholder: "owner/name",
    },
    {
      key: "visibility",
      label: "visibility",
      kind: "string",
      placeholder: "public",
    },
    {
      key: "tag_prefix",
      label: "tag_prefix",
      kind: "string",
      placeholder: "v",
    },
    {
      key: "allowed_asset_roles",
      label: "allowed_asset_roles",
      kind: "stringList",
      placeholder: "installer, updater-archive",
    },
    { key: "updater_enabled", label: "updater_enabled", kind: "boolean" },
    {
      key: "enabled_platforms",
      label: "enabled_platforms",
      kind: "stringList",
      placeholder: "windows-x64, macos-arm64",
    },
    {
      key: "unsigned_release_override",
      label: "unsigned_release_override",
      kind: "boolean",
    },
  ],
};

const DESTINATION_CREDENTIALS: Record<
  string,
  Array<{ key: string; label: string }>
> = {
  sftp: [{ key: "ssh_private_key", label: "ssh_private_key" }],
  "github-release": [{ key: "github_token", label: "github_token" }],
};

function settingsObject(
  binding: RevisionAdapterBinding
): Record<string, JsonValue> {
  const settings = binding.settings;
  if (settings && typeof settings === "object" && !Array.isArray(settings)) {
    return settings as Record<string, JsonValue>;
  }
  return {};
}

function newRouteId(): string {
  return `route-${Math.random().toString(36).slice(2, 8)}`;
}

function newBinding(adapterId: string): RevisionAdapterBinding {
  return { adapterId, settingsVersion: 1, settings: {}, credentials: {} };
}

interface CompositionEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: ConfigProfile;
  /** 决议 #91：安装向导可预填执行后端；仅作表单初值，保存仍是显式动作。 */
  initialBackendId?: string | null;
  onSaveComposition: (
    profile: ConfigProfile,
    composition: PublishComposition
  ) => Promise<void>;
  onRebindProject: (profile: ConfigProfile) => Promise<void>;
}

export function CompositionEditorDialog({
  open,
  onOpenChange,
  profile,
  initialBackendId,
  onSaveComposition,
  onRebindProject,
}: CompositionEditorDialogProps) {
  const { translations } = useI18n();
  const t = translations.composition || {};
  const commonT = translations.common || {};

  const [catalog, setCatalog] = useState<PublishAdapterCatalog | null>(null);
  const [draft, setDraft] = useState<PublishComposition | null>(null);
  const [expandedRouteId, setExpandedRouteId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isRebinding, setIsRebinding] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    const draft = profile.composition
      ? (structuredClone(profile.composition) as PublishComposition)
      : null;
    if (
      draft &&
      initialBackendId &&
      draft.executionBackend.adapterId !== initialBackendId
    ) {
      draft.executionBackend = newBinding(initialBackendId);
    }
    setDraft(draft);
    setExpandedRouteId(null);
    let cancelled = false;
    void listPublishAdapterCatalog()
      .then((result) => {
        if (!cancelled) {
          setCatalog(result);
        }
      })
      .catch((error: unknown) => {
        toast.error(t.catalogFailed || "加载可用 Adapter 目录失败", {
          description: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [open, profile, initialBackendId, t.catalogFailed]);

  const updateDraft = useCallback(
    (mutate: (next: PublishComposition) => void) => {
      setDraft((current) => {
        if (!current) {
          return current;
        }
        const next = structuredClone(current) as PublishComposition;
        mutate(next);
        return next;
      });
    },
    [setDraft]
  );

  const invalidCredential = useMemo(() => {
    if (!draft) {
      return null;
    }
    for (const route of draft.deliveryRoutes) {
      for (const [key, reference] of Object.entries(
        route.destination.credentials
      )) {
        if (
          reference.trim() &&
          !CREDENTIAL_REFERENCE_PATTERN.test(reference.trim())
        ) {
          return { routeId: route.routeId, key };
        }
      }
    }
    return null;
  }, [draft]);

  const handleSave = async () => {
    if (!draft) {
      return;
    }
    if (invalidCredential) {
      toast.error(
        (
          t.credentialInvalid ||
          "凭据引用格式无效（应形如 keychain:one-publish/xxx）: {{location}}"
        ).replace(
          "{{location}}",
          `${invalidCredential.routeId}/${invalidCredential.key}`
        )
      );
      return;
    }
    if (draft.deliveryRoutes.length === 0) {
      toast.error(t.routesRequired || "发布组合至少需要一条交付路线");
      return;
    }
    setIsSaving(true);
    try {
      // 空引用与空字符串设置不入库：未配置就保持缺省，交由运行时校验。
      const cleaned = structuredClone(draft) as PublishComposition;
      for (const route of cleaned.deliveryRoutes) {
        route.destination.credentials = Object.fromEntries(
          Object.entries(route.destination.credentials).filter(
            ([, reference]) => reference.trim() !== ""
          )
        );
        const settings = settingsObject(route.destination);
        route.destination.settings = Object.fromEntries(
          Object.entries(settings).filter(([, value]) => value !== "")
        );
      }
      await onSaveComposition(profile, cleaned);
      toast.success(t.saveSuccess || "发布组合已保存为新修订");
      onOpenChange(false);
    } catch (error) {
      toast.error(t.saveFailed || "保存发布组合失败", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleRebind = async () => {
    setIsRebinding(true);
    try {
      await onRebindProject(profile);
      toast.success(t.rebindSuccess || "已重新绑定到当前候选并产生新修订");
      onOpenChange(false);
    } catch (error) {
      toast.error(t.rebindFailed || "重新绑定失败", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsRebinding(false);
    }
  };

  const renderAdapterSelect = (
    id: string,
    value: string,
    options: string[],
    onChange: (adapterId: string) => void
  ) => (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="h-8 text-label-12">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(options.includes(value) ? options : [value, ...options]).map(
          (option) => (
            <SelectItem key={option} value={option} className="text-label-12">
              {option}
            </SelectItem>
          )
        )}
      </SelectContent>
    </Select>
  );

  const renderFieldInput = (
    route: RevisionDeliveryRoute,
    field: DestinationField
  ) => {
    const settings = settingsObject(route.destination);
    const raw = settings[field.key];
    const setValue = (value: JsonValue | undefined) => {
      updateDraft((next) => {
        const target = next.deliveryRoutes.find(
          (candidate) => candidate.routeId === route.routeId
        );
        if (!target) {
          return;
        }
        const nextSettings = settingsObject(target.destination);
        if (value === undefined) {
          delete nextSettings[field.key];
        } else {
          nextSettings[field.key] = value;
        }
        target.destination.settings = nextSettings;
      });
    };

    if (field.kind === "boolean") {
      return (
        <div className="flex items-center justify-between gap-3">
          <Label className="text-label-12">{field.label}</Label>
          <Switch
            checked={raw === true}
            onCheckedChange={(checked) => setValue(checked)}
            aria-label={field.label}
          />
        </div>
      );
    }

    const textValue =
      field.kind === "stringList"
        ? Array.isArray(raw)
          ? raw.map((item) => String(item)).join(", ")
          : ""
        : raw === undefined || raw === null
          ? ""
          : String(raw);
    return (
      <div className="space-y-1">
        <Label
          className="text-label-12"
          htmlFor={`${route.routeId}-${field.key}`}
        >
          {field.label}
        </Label>
        <Input
          id={`${route.routeId}-${field.key}`}
          className="h-8 text-label-12"
          value={textValue}
          placeholder={field.placeholder}
          onChange={(event) => {
            const input = event.target.value;
            if (field.kind === "number") {
              const parsed = Number(input);
              setValue(
                input.trim() === ""
                  ? undefined
                  : Number.isFinite(parsed)
                    ? parsed
                    : input
              );
            } else if (field.kind === "stringList") {
              const items = input
                .split(",")
                .map((item) => item.trim())
                .filter((item) => item !== "");
              setValue(input.trim() === "" ? undefined : items);
            } else {
              setValue(input);
            }
          }}
        />
      </div>
    );
  };

  const moveItem = <T,>(items: T[], index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= items.length) {
      return;
    }
    const [item] = items.splice(index, 1);
    items.splice(target, 0, item);
  };

  const destinations = catalog?.deliveryDestinations ?? [];
  const processors = catalog?.artifactProcessors ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AppDialogShell
        size="workspace"
        title={(t.title || "发布组合：{{name}}").replace(
          "{{name}}",
          profile.name
        )}
        description={
          t.description ||
          "编辑该配置的执行环境、产物处理与交付路线；保存会产生一版新修订。"
        }
        icon={<Layers3 className="size-4" />}
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
              data-testid="composition-save"
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
        <SectionShell
          icon={Link2}
          title={t.projectBindingTitle || "项目绑定"}
          description={
            t.projectBindingDescription ||
            "修订固化的项目候选；换绑是显式动作，会立即产生新修订并关闭编辑器。"
          }
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <code className="truncate rounded-sm bg-muted px-2 py-1 text-label-12">
              {profile.projectBinding ||
                t.projectBindingMissing ||
                "未绑定（存量修订，保存后自动固化）"}
            </code>
            <Button
              type="button"
              variant="outline"
              className="h-8"
              onClick={() => void handleRebind()}
              disabled={isRebinding}
              data-testid="composition-rebind"
            >
              {isRebinding ? (
                <span className="mr-2 inline-block animate-spin">
                  <Loader2 className="size-4" />
                </span>
              ) : null}
              {t.rebindAction || "重新绑定到当前候选"}
            </Button>
          </div>
        </SectionShell>

        {draft ? (
          <>
            <SectionShell
              icon={Boxes}
              title={t.executionTitle || "执行与存储"}
              description={
                t.executionDescription ||
                "只列出本机注册表实际支持的 Adapter；远端执行落地后会自动出现。"
              }
            >
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label
                    className="text-label-12"
                    htmlFor="composition-backend"
                  >
                    Execution Backend
                  </Label>
                  {renderAdapterSelect(
                    "composition-backend",
                    draft.executionBackend.adapterId,
                    catalog?.executionBackends ?? [],
                    (adapterId) =>
                      updateDraft((next) => {
                        next.executionBackend = newBinding(adapterId);
                      })
                  )}
                </div>
                <div className="space-y-1">
                  <Label className="text-label-12" htmlFor="composition-store">
                    Artifact Store
                  </Label>
                  {renderAdapterSelect(
                    "composition-store",
                    draft.artifactStore.adapterId,
                    catalog?.artifactStores ?? [],
                    (adapterId) =>
                      updateDraft((next) => {
                        next.artifactStore = newBinding(adapterId);
                      })
                  )}
                </div>
              </div>
            </SectionShell>

            <SectionShell
              icon={Layers3}
              title={t.processorsTitle || "产物处理（有序）"}
              description={
                t.processorsDescription ||
                "处理器在产物封存前按顺序运行，对所有 Provider 生效。"
              }
            >
              <div className="space-y-2">
                {draft.artifactProcessors.map((processor, index) => (
                  <div
                    key={`${processor.adapterId}-${index}`}
                    className="flex items-center justify-between gap-3 rounded-sm border border-border px-3 py-2"
                  >
                    <span className="text-label-12">
                      {index + 1}. {processor.adapterId}
                    </span>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        className="size-7 p-0"
                        aria-label={`${t.moveUp || "上移"}: ${processor.adapterId}`}
                        disabled={index === 0}
                        onClick={() =>
                          updateDraft((next) =>
                            moveItem(next.artifactProcessors, index, -1)
                          )
                        }
                      >
                        <ArrowUp className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="size-7 p-0"
                        aria-label={`${t.moveDown || "下移"}: ${processor.adapterId}`}
                        disabled={index === draft.artifactProcessors.length - 1}
                        onClick={() =>
                          updateDraft((next) =>
                            moveItem(next.artifactProcessors, index, 1)
                          )
                        }
                      >
                        <ArrowDown className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="size-7 p-0 text-destructive hover:text-destructive"
                        aria-label={`${t.remove || "移除"}: ${processor.adapterId}`}
                        onClick={() =>
                          updateDraft((next) => {
                            next.artifactProcessors.splice(index, 1);
                          })
                        }
                      >
                        <X className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
                {processors.length > 0 ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8"
                    onClick={() =>
                      updateDraft((next) => {
                        next.artifactProcessors.push(newBinding(processors[0]));
                      })
                    }
                  >
                    <Plus className="mr-2 size-3.5" />
                    {t.addProcessor || "添加 Processor"}
                  </Button>
                ) : null}
              </div>
            </SectionShell>

            <SectionShell
              icon={Route}
              title={t.routesTitle || "交付路线（有序）"}
              description={
                t.routesDescription ||
                "所有路线消费同一份封存产物；Required 路线全部发布才算完整成功。"
              }
            >
              <div className="space-y-2">
                {draft.deliveryRoutes.map((route, index) => {
                  const expanded = expandedRouteId === route.routeId;
                  const fields =
                    DESTINATION_FIELDS[route.destination.adapterId] ?? [];
                  const credentials =
                    DESTINATION_CREDENTIALS[route.destination.adapterId] ?? [];
                  return (
                    <div
                      key={route.routeId}
                      className="rounded-sm border border-border"
                      data-testid={`composition-route-${route.routeId}`}
                    >
                      <div className="flex flex-wrap items-center gap-3 px-3 py-2">
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          onClick={() =>
                            setExpandedRouteId(expanded ? null : route.routeId)
                          }
                          aria-expanded={expanded}
                          aria-label={`${t.expandRoute || "展开路线"}: ${route.routeId}`}
                        >
                          <ChevronDown
                            className={cn(
                              "size-3.5 text-muted-foreground transition-transform",
                              expanded ? "" : "-rotate-90"
                            )}
                          />
                          <span className="truncate text-label-12 font-semibold">
                            {index + 1}. {route.routeId}
                          </span>
                          <span className="text-label-12 text-muted-foreground">
                            {route.destination.adapterId}
                          </span>
                        </button>
                        <div className="flex items-center gap-2">
                          <Label className="text-label-12 text-muted-foreground">
                            {t.requiredLabel || "必需"}
                          </Label>
                          <Switch
                            checked={route.required}
                            aria-label={`${t.requiredLabel || "必需"}: ${route.routeId}`}
                            onCheckedChange={(checked) =>
                              updateDraft((next) => {
                                const target = next.deliveryRoutes.find(
                                  (candidate) =>
                                    candidate.routeId === route.routeId
                                );
                                if (target) {
                                  target.required = checked;
                                }
                              })
                            }
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            className="size-7 p-0"
                            aria-label={`${t.moveUp || "上移"}: ${route.routeId}`}
                            disabled={index === 0}
                            onClick={() =>
                              updateDraft((next) =>
                                moveItem(next.deliveryRoutes, index, -1)
                              )
                            }
                          >
                            <ArrowUp className="size-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            className="size-7 p-0"
                            aria-label={`${t.moveDown || "下移"}: ${route.routeId}`}
                            disabled={index === draft.deliveryRoutes.length - 1}
                            onClick={() =>
                              updateDraft((next) =>
                                moveItem(next.deliveryRoutes, index, 1)
                              )
                            }
                          >
                            <ArrowDown className="size-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            className="size-7 p-0 text-destructive hover:text-destructive"
                            aria-label={`${t.remove || "移除"}: ${route.routeId}`}
                            onClick={() =>
                              updateDraft((next) => {
                                next.deliveryRoutes =
                                  next.deliveryRoutes.filter(
                                    (candidate) =>
                                      candidate.routeId !== route.routeId
                                  );
                              })
                            }
                          >
                            <X className="size-3.5" />
                          </Button>
                        </div>
                      </div>
                      {expanded ? (
                        <div className="space-y-3 border-t border-border px-3 py-3">
                          <div className="space-y-1">
                            <Label
                              className="text-label-12"
                              htmlFor={`${route.routeId}-destination`}
                            >
                              Destination
                            </Label>
                            {renderAdapterSelect(
                              `${route.routeId}-destination`,
                              route.destination.adapterId,
                              destinations,
                              (adapterId) =>
                                updateDraft((next) => {
                                  const target = next.deliveryRoutes.find(
                                    (candidate) =>
                                      candidate.routeId === route.routeId
                                  );
                                  if (target) {
                                    target.destination = newBinding(adapterId);
                                  }
                                })
                            )}
                          </div>
                          {fields.length === 0 && credentials.length === 0 ? (
                            <AppDialogInset className="px-3 py-2 text-label-12 text-muted-foreground">
                              {t.noRouteSettings ||
                                "该目标没有需要配置的设置；本地目录由运行时派生。"}
                            </AppDialogInset>
                          ) : (
                            <div className="grid gap-3 md:grid-cols-2">
                              {fields.map((field) => (
                                <div key={field.key}>
                                  {renderFieldInput(route, field)}
                                </div>
                              ))}
                            </div>
                          )}
                          {credentials.map((credential) => {
                            const reference =
                              route.destination.credentials[credential.key] ??
                              "";
                            const invalid =
                              reference.trim() !== "" &&
                              !CREDENTIAL_REFERENCE_PATTERN.test(
                                reference.trim()
                              );
                            return (
                              <div key={credential.key} className="space-y-1">
                                <Label
                                  className="text-label-12"
                                  htmlFor={`${route.routeId}-${credential.key}`}
                                >
                                  {credential.label}
                                  <span className="ml-2 text-muted-foreground">
                                    {t.credentialHint || "凭据引用（非秘密值）"}
                                  </span>
                                </Label>
                                <Input
                                  id={`${route.routeId}-${credential.key}`}
                                  className={cn(
                                    "h-8 text-label-12",
                                    invalid && "border-destructive"
                                  )}
                                  value={reference}
                                  placeholder="keychain:one-publish/sftp-mirror"
                                  onChange={(event) =>
                                    updateDraft((next) => {
                                      const target = next.deliveryRoutes.find(
                                        (candidate) =>
                                          candidate.routeId === route.routeId
                                      );
                                      if (target) {
                                        target.destination.credentials = {
                                          ...target.destination.credentials,
                                          [credential.key]: event.target.value,
                                        };
                                      }
                                    })
                                  }
                                />
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {destinations.length > 0 ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8"
                    data-testid="composition-add-route"
                    onClick={() =>
                      updateDraft((next) => {
                        const routeId = newRouteId();
                        next.deliveryRoutes.push({
                          routeId,
                          required: false,
                          destination: newBinding(destinations[0]),
                        });
                        setExpandedRouteId(routeId);
                      })
                    }
                  >
                    <Plus className="mr-2 size-3.5" />
                    {t.addRoute || "添加路线"}
                  </Button>
                ) : null}
              </div>
            </SectionShell>
          </>
        ) : (
          <AppDialogInset className="px-4 py-6 text-label-12 text-muted-foreground">
            {t.compositionMissing || "该配置的当前修订缺少发布组合，无法编辑。"}
          </AppDialogInset>
        )}
      </AppDialogShell>
    </Dialog>
  );
}
