import {
  FileCog,
  FolderOutput,
  Layers3,
  Loader2,
  Save,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { memo, startTransition, useCallback, useMemo } from "react";

import { AppDialogShell } from "@/components/ui/app-dialog-shell";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionShell } from "@/components/ui/section-shell";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ArrayParameter } from "@/components/publish/ArrayParameter";
import { BooleanParameter } from "@/components/publish/BooleanParameter";
import { MapParameter } from "@/components/publish/MapParameter";
import { StringParameter } from "@/components/publish/StringParameter";
import {
  buildDotnetAdvancedParameters,
  normalizeDotnetPropertyMap,
  normalizeDotnetStringArray,
} from "@/lib/dotnetPublishConfig";
import type { PublishConfigStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { ParameterSchema, ParameterValue } from "@/types/parameters";

interface QuickCreateTemplateOption {
  id: string;
  name: string;
  description?: string;
}

type QuickCreateTranslations = Record<string, string | undefined>;
type AppTranslations = Record<string, string | undefined>;

interface QuickCreateProfileDialogProps {
  open: boolean;
  quickCreateProfileOpen: boolean;
  quickCreateTemplateId: string;
  quickCreateTemplateOptions: QuickCreateTemplateOption[];
  quickCreateProfileName: string;
  quickCreateProfileGroup: string;
  quickCreateProfileGroupOptions: string[];
  quickCreateProfileCustomGroup: string;
  quickCreateProfileDraft: PublishConfigStore;
  quickCreateProfileSaving: boolean;
  quickCreateEditing: boolean;
  dotnetSchema?: ParameterSchema;
  quickCreateGroupDefaultValue: string;
  quickCreateGroupCustomValue: string;
  profileT: QuickCreateTranslations;
  appT: AppTranslations;
  cancelLabel: string;
  onOpenChange: (open: boolean) => void;
  onApplyTemplate: (id: string) => void;
  onProfileNameChange: (value: string) => void;
  onProfileGroupChange: (value: string) => void;
  onProfileCustomGroupChange: (value: string) => void;
  onDraftChange: (patch: Partial<PublishConfigStore>) => void;
  onSave: () => void;
}

const QUICK_CREATE_BASIC_PARAM_KEYS = new Set([
  "configuration",
  "runtime",
  "output",
  "self_contained",
]);

function getParameterDefaultValue(type: string): ParameterValue {
  switch (type) {
    case "boolean":
      return false;
    case "array":
      return [];
    case "map":
      return {};
    case "string":
    default:
      return "";
  }
}

const QuickCreateTemplateCard = memo(function QuickCreateTemplateCard({
  quickCreateEditing,
  profileT,
  quickCreateTemplateId,
  quickCreateTemplateOptions,
  selectedTemplateDescription,
  onApplyTemplate,
}: {
  quickCreateEditing: boolean;
  profileT: QuickCreateTranslations;
  quickCreateTemplateId: string;
  quickCreateTemplateOptions: QuickCreateTemplateOption[];
  selectedTemplateDescription: string | null;
  onApplyTemplate: (id: string) => void;
}) {
  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-base font-semibold text-foreground">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary shadow-[var(--glass-inset-shadow)]">
                <Sparkles className="h-4 w-4" />
              </span>
              {profileT.quickCreateTemplateCompactTitle || "快速套用模板"}
            </div>
            <CardDescription className="mt-1 text-xs leading-5">
              {quickCreateEditing
                ? profileT.quickEditTemplateHint ||
                  "可选模板只作为辅助入口，当前表单修改优先。"
                : profileT.quickCreateTemplateHint ||
                  "先选模板快速回填参数，再按需细调。"}
            </CardDescription>
          </div>

          <div className="w-full md:w-[250px]">
            <Label
              htmlFor="quick-profile-template"
              className="mb-2 inline-block text-xs font-medium text-muted-foreground"
            >
              {profileT.quickCreateTemplate || "预置模板"}
            </Label>
            <Select
              value={quickCreateTemplateId}
              onValueChange={onApplyTemplate}
            >
              <SelectTrigger
                id="quick-profile-template"
                className="h-11 bg-background/50"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {quickCreateTemplateOptions.map((option) => (
                  <SelectItem
                    key={`quick-template-option-${option.id}`}
                    value={option.id}
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate">{option.name}</span>
                      {option.description ? (
                        <span className="truncate text-[11px] text-muted-foreground">
                          {option.description}
                        </span>
                      ) : null}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      {selectedTemplateDescription ? (
        <CardContent className="pt-0">
          <div className="rounded-xl border border-[var(--glass-border-subtle)] bg-[var(--glass-input-bg)] px-3 py-2.5 text-xs leading-5 text-muted-foreground">
            {selectedTemplateDescription}
          </div>
        </CardContent>
      ) : null}
    </Card>
  );
});

const QuickCreateBasicInfoSection = memo(function QuickCreateBasicInfoSection({
  profileT,
  quickCreateProfileName,
  quickCreateProfileGroup,
  quickCreateGroupDefaultValue,
  quickCreateGroupCustomValue,
  quickCreateProfileGroupOptions,
  quickCreateProfileCustomGroup,
  onProfileNameChange,
  onProfileNameKeyDown,
  onProfileGroupChange,
  onProfileCustomGroupChange,
}: {
  profileT: QuickCreateTranslations;
  quickCreateProfileName: string;
  quickCreateProfileGroup: string;
  quickCreateGroupDefaultValue: string;
  quickCreateGroupCustomValue: string;
  quickCreateProfileGroupOptions: string[];
  quickCreateProfileCustomGroup: string;
  onProfileNameChange: (value: string) => void;
  onProfileNameKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  onProfileGroupChange: (value: string) => void;
  onProfileCustomGroupChange: (value: string) => void;
}) {
  return (
    <SectionShell
      icon={Layers3}
      title={profileT.quickCreateBasicSection || "基础信息"}
      description={
        profileT.quickCreateBasicSectionDescription ||
        "先命名并归类，再继续完善发布参数。"
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="quick-profile-name">
            {profileT.quickCreateName || "配置名称"}
          </Label>
          <Input
            id="quick-profile-name"
            placeholder={
              profileT.profileNamePlaceholder || "输入配置文件名称"
            }
            value={quickCreateProfileName}
            onChange={(event) => onProfileNameChange(event.target.value)}
            onKeyDown={onProfileNameKeyDown}
          />
          <p className="text-xs leading-5 text-muted-foreground">
            {profileT.quickCreateNameHint ||
              "配置名会直接显示在中栏列表里，建议简短清晰。"}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="quick-profile-group">
            {profileT.quickCreateGroup || "发布配置组"}
          </Label>
          <Select
            value={quickCreateProfileGroup}
            onValueChange={onProfileGroupChange}
          >
            <SelectTrigger id="quick-profile-group">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={quickCreateGroupDefaultValue}>
                {profileT.quickCreateGroupDefault || "默认分组"}
              </SelectItem>
              {quickCreateProfileGroupOptions.map((group) => (
                <SelectItem
                  key={`quick-profile-group-${group}`}
                  value={group}
                >
                  {group}
                </SelectItem>
              ))}
              <SelectItem value={quickCreateGroupCustomValue}>
                {profileT.quickCreateGroupCustom || "自定义分组"}
              </SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs leading-5 text-muted-foreground">
            {profileT.quickCreateGroupHint ||
              "用于在中栏按组归类，便于后续快速筛选和定位。"}
          </p>
        </div>

        {quickCreateProfileGroup === quickCreateGroupCustomValue ? (
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="quick-profile-group-custom">
              {profileT.quickCreateGroupCustom || "自定义分组"}
            </Label>
            <Input
              id="quick-profile-group-custom"
              value={quickCreateProfileCustomGroup}
              onChange={(event) =>
                onProfileCustomGroupChange(event.target.value)
              }
              placeholder={
                profileT.quickCreateGroupCustomPlaceholder ||
                "输入自定义发布配置组名称"
              }
            />
          </div>
        ) : null}
      </div>
    </SectionShell>
  );
});

const QuickCreateParametersSection = memo(function QuickCreateParametersSection({
  profileT,
  appT,
  configuration,
  runtime,
  onConfigurationChange,
  onRuntimeChange,
}: {
  profileT: QuickCreateTranslations;
  appT: AppTranslations;
  configuration: string;
  runtime: string;
  onConfigurationChange: (value: string) => void;
  onRuntimeChange: (value: string) => void;
}) {
  return (
    <SectionShell
      icon={SlidersHorizontal}
      title={profileT.quickCreateParametersSection || "发布参数"}
      description={
        profileT.quickCreateParametersSectionDescription ||
        "先确定构建配置和运行时，再决定输出部署方式。"
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="quick-profile-configuration">
            {appT.configurationType || "配置类型"}
          </Label>
          <Select
            value={configuration}
            onValueChange={onConfigurationChange}
          >
            <SelectTrigger id="quick-profile-configuration">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Release">Release</SelectItem>
              <SelectItem value="Debug">Debug</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="quick-profile-runtime">
            {appT.runtimeLabel || "运行时"}
          </Label>
          <Select value={runtime || "none"} onValueChange={onRuntimeChange}>
            <SelectTrigger id="quick-profile-runtime">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">
                {appT.frameworkDependent || "框架依赖"}
              </SelectItem>
              <SelectItem value="win-x64">Windows x64</SelectItem>
              <SelectItem value="osx-arm64">macOS ARM64</SelectItem>
              <SelectItem value="osx-x64">macOS x64</SelectItem>
              <SelectItem value="linux-x64">Linux x64</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs leading-5 text-muted-foreground">
            {profileT.quickCreateRuntimeHint ||
              "未指定运行时时将保持框架依赖模式。"}
          </p>
        </div>
      </div>
    </SectionShell>
  );
});

const QuickCreateOutputSection = memo(function QuickCreateOutputSection({
  profileT,
  appT,
  outputDir,
  selfContained,
  isRuntimeRequired,
  onOutputDirChange,
  onSelfContainedChange,
}: {
  profileT: QuickCreateTranslations;
  appT: AppTranslations;
  outputDir: string;
  selfContained: boolean;
  isRuntimeRequired: boolean;
  onOutputDirChange: (value: string) => void;
  onSelfContainedChange: (checked: boolean) => void;
}) {
  return (
    <SectionShell
      icon={FolderOutput}
      title={profileT.quickCreateOutputSection || "输出与部署"}
      description={
        profileT.quickCreateOutputSectionDescription ||
        "控制产物输出目录和部署形态，保存后会按这些参数执行发布。"
      }
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="quick-profile-output">
            {appT.outputDirLabel || "输出目录"}
          </Label>
          <Input
            id="quick-profile-output"
            value={outputDir}
            onChange={(event) => onOutputDirChange(event.target.value)}
            placeholder={appT.outputDirPlaceholder || "留空使用默认目录"}
          />
          <p className="text-xs leading-5 text-muted-foreground">
            {profileT.quickCreateOutputHint ||
              "留空时会回落到默认输出目录规则。"}
          </p>
        </div>

        <div
          className={cn(
            "rounded-2xl border border-[var(--glass-border-subtle)] bg-[var(--glass-input-bg)] p-4 shadow-[var(--glass-inset-shadow)]",
            isRuntimeRequired && "opacity-90"
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Label
                htmlFor="quick-profile-self-contained"
                className="text-sm font-medium text-foreground"
              >
                {appT.selfContained || "自包含部署"}
              </Label>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {isRuntimeRequired
                  ? profileT.quickCreateSelfContainedRuntimeRequired ||
                    "请先选择运行时，自包含部署才可启用。"
                  : profileT.quickCreateSelfContainedHint ||
                    "启用后会将运行时一起打包，产物更独立，但体积更大。"}
              </p>
            </div>
            <Switch
              id="quick-profile-self-contained"
              checked={selfContained}
              onCheckedChange={onSelfContainedChange}
              disabled={isRuntimeRequired}
            />
          </div>
        </div>
      </div>
    </SectionShell>
  );
});

const QuickCreateAdvancedParametersSection = memo(
  function QuickCreateAdvancedParametersSection({
    profileT,
    dotnetSchema,
    parameters,
    onParameterChange,
  }: {
    profileT: QuickCreateTranslations;
    dotnetSchema?: ParameterSchema;
    parameters: Record<string, ParameterValue>;
    onParameterChange: (key: string, value: ParameterValue) => void;
  }) {
    const advancedEntries = useMemo(
      () =>
        Object.entries(dotnetSchema?.parameters || {}).filter(
          ([key]) => !QUICK_CREATE_BASIC_PARAM_KEYS.has(key)
        ),
      [dotnetSchema]
    );

    if (advancedEntries.length === 0) {
      return null;
    }

    return (
      <SectionShell
        icon={FileCog}
        title={profileT.quickCreateAdvancedSection || "高级参数"}
        description={
          profileT.quickCreateAdvancedSectionDescription ||
          "补充框架、日志、MSBuild 属性和自定义 define，覆盖更多发布场景。"
        }
      >
        <div className="space-y-4">
          {advancedEntries.map(([key, definition]) => {
            const value = parameters[key] ?? getParameterDefaultValue(definition.type);

            return (
              <Card key={key} className="rounded-2xl">
                <CardHeader className="pb-2">
                  <div className="text-sm font-semibold text-foreground">{key}</div>
                  <CardDescription className="text-xs leading-5">
                    {definition.description || definition.flag}
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  {definition.type === "boolean" ? (
                    <BooleanParameter
                      definition={definition}
                      value={value as boolean}
                      onChange={(nextValue) => onParameterChange(key, nextValue)}
                    />
                  ) : null}
                  {definition.type === "string" ? (
                    <StringParameter
                      definition={definition}
                      value={value as string}
                      onChange={(nextValue) => onParameterChange(key, nextValue)}
                    />
                  ) : null}
                  {definition.type === "array" ? (
                    <ArrayParameter
                      definition={definition}
                      value={value as ParameterValue[]}
                      onChange={(nextValue) => onParameterChange(key, nextValue)}
                    />
                  ) : null}
                  {definition.type === "map" ? (
                    <MapParameter
                      definition={definition}
                      value={value as Record<string, ParameterValue>}
                      onChange={(nextValue) => onParameterChange(key, nextValue)}
                    />
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </SectionShell>
    );
  }
);

export function QuickCreateProfileDialog({
  open,
  quickCreateProfileOpen,
  quickCreateTemplateId,
  quickCreateTemplateOptions,
  quickCreateProfileName,
  quickCreateProfileGroup,
  quickCreateProfileGroupOptions,
  quickCreateProfileCustomGroup,
  quickCreateProfileDraft,
  quickCreateProfileSaving,
  quickCreateEditing,
  dotnetSchema,
  quickCreateGroupDefaultValue,
  quickCreateGroupCustomValue,
  profileT,
  appT,
  cancelLabel,
  onOpenChange,
  onApplyTemplate,
  onProfileNameChange,
  onProfileGroupChange,
  onProfileCustomGroupChange,
  onDraftChange,
  onSave,
}: QuickCreateProfileDialogProps) {
  if (!open && !quickCreateProfileOpen) {
    return null;
  }

  const selectedTemplate =
    quickCreateTemplateOptions.find(
      (option) => option.id === quickCreateTemplateId
    ) ?? quickCreateTemplateOptions[0] ?? null;
  const isRuntimeRequired = !quickCreateProfileDraft.runtime;
  const isSaveDisabled =
    quickCreateProfileSaving || !quickCreateProfileName.trim();

  const handleTemplateChange = useCallback(
    (templateId: string) => {
      startTransition(() => {
        onApplyTemplate(templateId);
      });
    },
    [onApplyTemplate]
  );

  const handleProfileNameKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter" || quickCreateProfileSaving) {
        return;
      }

      event.preventDefault();
      onSave();
    },
    [onSave, quickCreateProfileSaving]
  );

  const handleConfigurationChange = useCallback(
    (value: string) => {
      onDraftChange({ configuration: value });
    },
    [onDraftChange]
  );

  const handleRuntimeChange = useCallback(
    (value: string) => {
      onDraftChange({ runtime: value === "none" ? "" : value });
    },
    [onDraftChange]
  );

  const handleOutputDirChange = useCallback(
    (value: string) => {
      onDraftChange({ outputDir: value });
    },
    [onDraftChange]
  );

  const handleSelfContainedChange = useCallback(
    (checked: boolean) => {
      onDraftChange({ selfContained: checked });
    },
    [onDraftChange]
  );

  const advancedParameters = useMemo(
    () => buildDotnetAdvancedParameters(quickCreateProfileDraft),
    [quickCreateProfileDraft]
  );

  const handleAdvancedParameterChange = useCallback(
    (key: string, value: ParameterValue) => {
      switch (key) {
        case "framework":
          onDraftChange({ framework: typeof value === "string" ? value : "" });
          return;
        case "no_build":
          onDraftChange({ noBuild: value === true });
          return;
        case "no_restore":
          onDraftChange({ noRestore: value === true });
          return;
        case "verbosity":
          onDraftChange({ verbosity: typeof value === "string" ? value : "" });
          return;
        case "no_logo":
          onDraftChange({ noLogo: value === true });
          return;
        case "properties":
          onDraftChange({ properties: normalizeDotnetPropertyMap(value) });
          return;
        case "define":
          onDraftChange({ define: normalizeDotnetStringArray(value) });
          return;
        default:
          return;
      }
    },
    [onDraftChange]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AppDialogShell
        size="workspace"
        title={
          quickCreateEditing
            ? profileT.quickEditTitle || "编辑发布配置"
            : profileT.quickCreateTitle || "创建发布配置"
        }
        description={
          quickCreateEditing
            ? profileT.quickEditDescription || "修改发布配置后保存更新。"
            : profileT.quickCreateDescription ||
              "填写与自定义模式一致的参数并保存为发布配置。"
        }
        icon={
          quickCreateEditing ? (
            <Layers3 className="h-4 w-4" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )
        }
        iconWrapperClassName={cn(
          "shadow-[0_8px_20px_rgba(0,0,0,0.08)]",
          quickCreateEditing
            ? "bg-[var(--glass-input-bg)] text-foreground/75"
            : "bg-primary/10 text-primary"
        )}
        bodyInnerClassName="space-y-5"
        footerClassName="sm:space-x-0"
        footer={
          <>
            <div className="text-xs leading-5 text-muted-foreground">
              {quickCreateEditing
                ? profileT.quickEditFooterHint ||
                  "保存后会立即更新并应用当前发布配置。"
                : profileT.quickCreateFooterHint ||
                  "保存后会立即写入并应用到当前仓库。"}
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={quickCreateProfileSaving}
              >
                {cancelLabel}
              </Button>
              <Button
                type="button"
                onClick={onSave}
                disabled={isSaveDisabled}
                className="min-w-[148px]"
              >
                {quickCreateProfileSaving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {quickCreateEditing
                      ? profileT.quickEditSaving || "更新中..."
                      : profileT.quickCreateSaving || "保存中..."}
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    {quickCreateEditing
                      ? profileT.quickEditAction || "保存修改"
                      : profileT.quickCreateAction || "创建并保存"}
                  </>
                )}
              </Button>
            </div>
          </>
        }
      >
        <QuickCreateTemplateCard
          quickCreateEditing={quickCreateEditing}
          profileT={profileT}
          quickCreateTemplateId={quickCreateTemplateId}
          quickCreateTemplateOptions={quickCreateTemplateOptions}
          selectedTemplateDescription={selectedTemplate?.description || null}
          onApplyTemplate={handleTemplateChange}
        />

        <QuickCreateBasicInfoSection
          profileT={profileT}
          quickCreateProfileName={quickCreateProfileName}
          quickCreateProfileGroup={quickCreateProfileGroup}
          quickCreateGroupDefaultValue={quickCreateGroupDefaultValue}
          quickCreateGroupCustomValue={quickCreateGroupCustomValue}
          quickCreateProfileGroupOptions={quickCreateProfileGroupOptions}
          quickCreateProfileCustomGroup={quickCreateProfileCustomGroup}
          onProfileNameChange={onProfileNameChange}
          onProfileNameKeyDown={handleProfileNameKeyDown}
          onProfileGroupChange={onProfileGroupChange}
          onProfileCustomGroupChange={onProfileCustomGroupChange}
        />

        <QuickCreateParametersSection
          profileT={profileT}
          appT={appT}
          configuration={quickCreateProfileDraft.configuration}
          runtime={quickCreateProfileDraft.runtime}
          onConfigurationChange={handleConfigurationChange}
          onRuntimeChange={handleRuntimeChange}
        />

        <QuickCreateOutputSection
          profileT={profileT}
          appT={appT}
          outputDir={quickCreateProfileDraft.outputDir}
          selfContained={quickCreateProfileDraft.selfContained}
          isRuntimeRequired={isRuntimeRequired}
          onOutputDirChange={handleOutputDirChange}
          onSelfContainedChange={handleSelfContainedChange}
        />

        <QuickCreateAdvancedParametersSection
          profileT={profileT}
          dotnetSchema={dotnetSchema}
          parameters={advancedParameters}
          onParameterChange={handleAdvancedParameterChange}
        />
      </AppDialogShell>
    </Dialog>
  );
}
