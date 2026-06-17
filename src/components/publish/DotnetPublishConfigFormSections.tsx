import { memo, useCallback, useMemo, type ReactNode } from "react";
import {
  FileCog,
  FolderOutput,
  Plus,
  SlidersHorizontal,
  X,
} from "lucide-react";

import { OutputTargetBadge } from "@/components/publish/OutputTargetBadge";
import { Button } from "@/components/ui/button";
import { HelpTip } from "@/components/ui/help-tip";
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
import { Switch, SwitchIndicator } from "@/components/ui/switch";
import {
  buildDotnetAdvancedFieldsModel,
  type DotnetAdvancedFieldModel,
} from "@/features/config/dotnetPublishAdvancedFields";
import { normalizeDotnetPropertyMap } from "@/features/config/dotnetPublishConfig";
import type { PublishConfigStore } from "@/lib/store/types";
import { cn } from "@/lib/utils";
import type { ParameterSchema, ParameterValue } from "@/types/parameters";

type FormTranslations = Record<string, string | undefined>;

export type DotnetPublishConfigFormMode = "edit" | "readonly";
export type DotnetPublishConfigFormPresentation = "standard" | "focused";

interface DotnetPublishConfigFormSectionsProps {
  mode?: DotnetPublishConfigFormMode;
  presentation?: DotnetPublishConfigFormPresentation;
  profileT: FormTranslations;
  appT: FormTranslations;
  config: PublishConfigStore;
  dotnetSchema?: ParameterSchema;
  projectFrameworkOptions?: string[];
  onDraftChange?: (patch: Partial<PublishConfigStore>) => void;
}

const EMPTY_SELECT_VALUE = "__empty__";
const EMPTY_PROJECT_FRAMEWORK_OPTIONS: string[] = [];
const EMPTY_ADVANCED_FIELDS: DotnetAdvancedFieldModel[] = [];

interface LocalizedAdvancedFieldText {
  title: string;
  label: string;
  description: string;
  technicalLabel: string;
  emptyOptionLabel: string;
  inputPlaceholder: string;
  helperText?: string;
  propertiesHint: string;
  propertiesAddLabel: string;
  propertiesEmptyText: string;
  propertyKeyColumnLabel: string;
  propertyValueColumnLabel: string;
  propertyKeyPlaceholder: string;
  propertyValuePlaceholder: string;
  removePropertyLabel: string;
  technicalLabelPrefix: string;
}

const DotnetPublishParametersSection = memo(function DotnetPublishParametersSection({
  profileT,
  appT,
  configuration,
  runtime,
  readOnly,
  onConfigurationChange,
  onRuntimeChange,
}: {
  profileT: FormTranslations;
  appT: FormTranslations;
  configuration: string;
  runtime: string;
  readOnly: boolean;
  onConfigurationChange: (value: string) => void;
  onRuntimeChange: (value: string) => void;
}): ReactNode {
  return (
    <SectionShell
      icon={SlidersHorizontal}
      title={profileT.quickCreateParametersSection || "发布参数"}
      description={
        profileT.quickCreateParametersSectionDescription ||
        "先确定构建配置和运行时，再决定输出部署方式。"
      }
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="quick-profile-configuration" className="text-xs">
            {appT.configurationType || "配置类型"}
          </Label>
          <Select value={configuration} onValueChange={onConfigurationChange}>
            <SelectTrigger
              id="quick-profile-configuration"
              disabled={readOnly}
              className="h-9 text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Release" className="text-xs">Release</SelectItem>
              <SelectItem value="Debug" className="text-xs">Debug</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="quick-profile-runtime" className="text-xs">
              {appT.runtimeLabel || "运行时"}
            </Label>
            <HelpTip
              text={profileT.quickCreateRuntimeHint || "未指定运行时时将保持框架依赖模式。"}
              label={appT.runtimeLabel || "运行时"}
            />
          </div>
          <Select value={runtime || "none"} onValueChange={onRuntimeChange}>
            <SelectTrigger id="quick-profile-runtime" disabled={readOnly} className="h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none" className="text-xs">
                {appT.frameworkDependent || "框架依赖"}
              </SelectItem>
              <SelectItem value="win-x64" className="text-xs">Windows x64</SelectItem>
              <SelectItem value="osx-arm64" className="text-xs">macOS ARM64</SelectItem>
              <SelectItem value="osx-x64" className="text-xs">macOS x64</SelectItem>
              <SelectItem value="linux-x64" className="text-xs">Linux x64</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </SectionShell>
  );
});

const DotnetPublishOutputSection = memo(function DotnetPublishOutputSection({
  profileT,
  appT,
  outputDir,
  selfContained,
  isRuntimeRequired,
  readOnly,
  onOutputDirChange,
  onSelfContainedChange,
}: {
  profileT: FormTranslations;
  appT: FormTranslations;
  outputDir: string;
  selfContained: boolean;
  isRuntimeRequired: boolean;
  readOnly: boolean;
  onOutputDirChange: (value: string) => void;
  onSelfContainedChange: (checked: boolean) => void;
}): ReactNode {
  return (
    <SectionShell
      icon={FolderOutput}
      title={profileT.quickCreateOutputSection || "输出与部署"}
      description={
        profileT.quickCreateOutputSectionDescription ||
        "控制产物输出目录和部署形态，保存后会按这些参数执行发布。"
      }
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="quick-profile-output" className="text-xs">
              {appT.outputDirLabel || "输出目录"}
            </Label>
            <HelpTip
              text={profileT.quickCreateOutputHint || "留空时会回落到默认输出目录规则。"}
              label={appT.outputDirLabel || "输出目录"}
            />
            <OutputTargetBadge
              raw={outputDir}
              translations={{
                outputTargetBadgeLocal: appT.outputTargetBadgeLocal,
                outputTargetBadgeUnc: appT.outputTargetBadgeUnc,
                outputTargetBadgeMounted: appT.outputTargetBadgeMounted,
                outputTargetBadgeRemoteSuffix:
                  appT.outputTargetBadgeRemoteSuffix,
                outputTargetBadgeRemoteTooltip:
                  appT.outputTargetBadgeRemoteTooltip,
              }}
            />
          </div>
          <Input
            id="quick-profile-output"
            value={outputDir}
            onChange={(event) => onOutputDirChange(event.target.value)}
            placeholder={appT.outputDirPlaceholder || "留空使用默认目录"}
            readOnly={readOnly}
            className="h-9 text-xs"
          />
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-1.5 h-5">
            <Label
              htmlFor="quick-profile-self-contained"
              className="text-xs"
            >
              {appT.selfContained || "自包含部署"}
            </Label>
            <HelpTip
              align="end"
              text={
                isRuntimeRequired
                  ? profileT.quickCreateSelfContainedRuntimeRequired ||
                    "需先选运行时才可启用自包含。"
                  : profileT.quickCreateSelfContainedHint ||
                    "包含运行时，体积大但更独立。"
              }
              label={appT.selfContained || "自包含部署"}
            />
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={selfContained}
            aria-label={appT.selfContained || "自包含部署"}
            disabled={readOnly || isRuntimeRequired}
            className={cn(
              "glass-input flex h-9 w-full items-center justify-between rounded-xl px-3 text-left transition duration-300 disabled:pointer-events-none",
              !readOnly && !isRuntimeRequired && "hover:border-primary/30 cursor-pointer select-none",
              isRuntimeRequired && "opacity-50 cursor-not-allowed bg-black/5 dark:bg-white/5"
            )}
            onClick={() => {
              onSelfContainedChange(!selfContained);
            }}
          >
            <span className="text-xs text-muted-foreground select-none truncate">
              {isRuntimeRequired
                ? "未指定运行时 (不可用)"
                : selfContained
                ? "Self-Contained (独立运行)"
                : "Framework-Dependent (依赖框架)"}
            </span>

            <div className="flex items-center gap-2">
              {selfContained && !isRuntimeRequired && (
                <span className="size-1.5 rounded-full bg-success animate-pulse shrink-0" />
              )}
              <SwitchIndicator checked={selfContained} />
            </div>
          </button>
        </div>
      </div>
    </SectionShell>
  );
});

function translate(
  translations: FormTranslations,
  key: string,
  fallback: string
): string {
  return translations[key] || fallback;
}

function formatTemplate(
  template: string,
  replacements: Record<string, string>
): string {
  return Object.entries(replacements).reduce(
    (result, [key, value]) => result.split(`{{${key}}}`).join(value),
    template
  );
}

function getTechnicalFieldLabel(field: DotnetAdvancedFieldModel): string {
  return field.definition.prefix || field.definition.flag || field.key;
}

function getLocalizedAdvancedFieldText(
  profileT: FormTranslations,
  field: DotnetAdvancedFieldModel
): LocalizedAdvancedFieldText {
  const defaults = {
    emptyOptionLabel: translate(profileT, "advancedFieldSelectEmpty", "未设置"),
    inputPlaceholder: formatTemplate(
      translate(profileT, "advancedFieldStringPlaceholder", "输入 {{field}}"),
      { field: field.label }
    ),
    propertiesHint: translate(
      profileT,
      "advancedFieldPropertiesHint",
      "这里用于管理未被提炼成固定字段的其余 MSBuild 属性。"
    ),
    propertiesAddLabel: translate(
      profileT,
      "advancedFieldPropertiesAdd",
      "添加属性"
    ),
    propertiesEmptyText: translate(
      profileT,
      "advancedFieldPropertiesEmpty",
      "当前没有其余 MSBuild 属性。"
    ),
    propertyKeyColumnLabel: translate(
      profileT,
      "advancedFieldPropertiesKey",
      "属性名"
    ),
    propertyValueColumnLabel: translate(
      profileT,
      "advancedFieldPropertiesValue",
      "属性值"
    ),
    propertyKeyPlaceholder: translate(
      profileT,
      "advancedFieldPropertiesKeyPlaceholder",
      "MSBuild 属性名"
    ),
    propertyValuePlaceholder: translate(
      profileT,
      "advancedFieldPropertiesValuePlaceholder",
      "MSBuild 属性值"
    ),
    removePropertyLabel: translate(
      profileT,
      "advancedFieldRemoveProperty",
      "移除属性 {{value}}"
    ),
    technicalLabelPrefix: translate(
      profileT,
      "advancedFieldTechnicalLabel",
      "参数标识"
    ),
  };

  const localized = (
    labelKey: string,
    labelFallback: string,
    descriptionKey: string,
    descriptionFallback: string,
    helperText?: string
  ): LocalizedAdvancedFieldText => {
    const translatedLabel = translate(profileT, labelKey, labelFallback);

    return {
      title: translatedLabel,
      label: translatedLabel,
      description: translate(profileT, descriptionKey, descriptionFallback),
      technicalLabel: getTechnicalFieldLabel(field),
      helperText,
      ...defaults,
      inputPlaceholder: formatTemplate(
        translate(profileT, "advancedFieldStringPlaceholder", "输入 {{field}}"),
        { field: translatedLabel }
      ),
    };
  };

  switch (field.key) {
    case "framework":
      return {
        ...localized(
          "advancedFieldFrameworkLabel",
          "目标框架",
          "advancedFieldFrameworkDescription",
          "对应 --framework。留空时不传该参数；优先使用当前项目解析出的目标框架，也支持输入自定义值。"
        ),
        inputPlaceholder: translate(
          profileT,
          "advancedFieldFrameworkPlaceholder",
          "留空表示不传 --framework"
        ),
        helperText: translate(
          profileT,
          "advancedFieldFrameworkHint",
          "优先展示当前项目解析出的目标框架，也可以直接输入自定义值。"
        ),
      };
    case "no_build":
      return localized(
        "advancedFieldNoBuildLabel",
        "跳过构建",
        "advancedFieldNoBuildDescription",
        "对应 --no-build。启用后会跳过 build 阶段。"
      );
    case "no_restore":
      return localized(
        "advancedFieldNoRestoreLabel",
        "跳过还原",
        "advancedFieldNoRestoreDescription",
        "对应 --no-restore。启用后会跳过 restore 阶段。"
      );
    case "verbosity":
      return localized(
        "advancedFieldVerbosityLabel",
        "日志详细级别",
        "advancedFieldVerbosityDescription",
        "对应 --verbosity。控制 MSBuild 日志输出级别。"
      );
    case "no_logo":
      return localized(
        "advancedFieldNoLogoLabel",
        "隐藏 .NET 标识",
        "advancedFieldNoLogoDescription",
        "对应 --no-logo。隐藏 dotnet publish 的启动标识输出。"
      );
    case "DeleteExistingFiles":
    case "delete_existing_files":
      return localized(
        "advancedFieldDeleteExistingFilesLabel",
        "发布前清空目标目录",
        "advancedFieldDeleteExistingFilesDescription",
        "发布前删除目标目录中的现有文件。"
      );
    case "PublishSingleFile":
      return localized(
        "advancedFieldPublishSingleFileLabel",
        "单文件发布",
        "advancedFieldPublishSingleFileDescription",
        "对应 MSBuild 属性 PublishSingleFile。启用后会将产物打包为单文件。"
      );
    case "properties":
      return localized(
        "advancedFieldPropertiesLabel",
        "其余 MSBuild 属性",
        "advancedFieldPropertiesDescription",
        "用于编辑未被提炼成固定字段的其余 MSBuild 属性。"
      );
    default:
      return {
        ...localized(field.key, field.label, field.key, field.description || field.label),
        inputPlaceholder: formatTemplate(
          translate(profileT, "advancedFieldStringPlaceholder", "输入 {{field}}"),
          { field: field.label }
        ),
      };
  }
}

function getLocalizedSelectOptions(
  profileT: FormTranslations,
  field: DotnetAdvancedFieldModel
) {
  if (field.key !== "verbosity") {
    return field.options || [];
  }

  return (field.options || []).map((option) => {
    switch (option.value) {
      case "quiet":
        return {
          value: option.value,
          label: translate(
            profileT,
            "advancedFieldVerbosityQuiet",
            "quiet（静默）"
          ),
        };
      case "minimal":
        return {
          value: option.value,
          label: translate(
            profileT,
            "advancedFieldVerbosityMinimal",
            "minimal（最少）"
          ),
        };
      case "normal":
        return {
          value: option.value,
          label: translate(
            profileT,
            "advancedFieldVerbosityNormal",
            "normal（正常）"
          ),
        };
      case "detailed":
        return {
          value: option.value,
          label: translate(
            profileT,
            "advancedFieldVerbosityDetailed",
            "detailed（详细）"
          ),
        };
      case "diagnostic":
        return {
          value: option.value,
          label: translate(
            profileT,
            "advancedFieldVerbosityDiagnostic",
            "diagnostic（诊断）"
          ),
        };
      default:
        return option;
    }
  });
}

const DotnetAdvancedFieldCards = memo(function DotnetAdvancedFieldCards({
  profileT,
  fields,
  readOnly,
  onParameterChange,
}: {
  profileT: FormTranslations;
  fields: DotnetAdvancedFieldModel[];
  readOnly: boolean;
  onParameterChange: (key: string, value: ParameterValue) => void;
}): ReactNode {
  return (
    <div className="grid gap-3.5 md:grid-cols-2">
      {fields.map((field) => {
        const localizedFieldText = getLocalizedAdvancedFieldText(profileT, field);
        const isFullWidth = field.control === "property-map";

        return (
          <div
            key={field.key}
            className={cn(
              "rounded-xl border border-input bg-background/20 p-3  flex flex-col justify-between",
              isFullWidth && "md:col-span-2"
            )}
          >
            <DotnetAdvancedFieldControl
              field={field}
              fieldText={localizedFieldText}
              profileT={profileT}
              readOnly={readOnly}
              onChange={(value) => onParameterChange(field.key, value)}
            />
          </div>
        );
      })}
    </div>
  );
});

const DotnetCollapsedReadonlyAdvancedFields = memo(
  function DotnetCollapsedReadonlyAdvancedFields({
    profileT,
    fields,
    readOnly,
    onParameterChange,
  }: {
    profileT: FormTranslations;
    fields: DotnetAdvancedFieldModel[];
    readOnly: boolean;
    onParameterChange: (key: string, value: ParameterValue) => void;
  }): ReactNode | null {
    if (fields.length === 0) {
      return null;
    }

    return (
      <SectionShell
        icon={FileCog}
        title={profileT.quickCreateAdditionalSection || "其余参数"}
        description={
          readOnly
            ? profileT.quickCreateAdditionalReadonlySectionDescription ||
              "展开后可查看当前发布配置里剩余的参数字段。"
            : profileT.quickCreateAdditionalSectionDescription ||
              "展开后可查看并编辑其余高级参数字段。"
        }
        collapsible
        defaultExpanded={false}
        badge={String(fields.length)}
      >
        <DotnetAdvancedFieldCards
          profileT={profileT}
          fields={fields}
          readOnly={readOnly}
          onParameterChange={onParameterChange}
        />
      </SectionShell>
    );
  }
);

const DotnetPublishAdvancedParametersSection = memo(
  function DotnetPublishAdvancedParametersSection({
    profileT,
    fields,
    collapsedFields,
    readOnly,
    onParameterChange,
  }: {
    profileT: FormTranslations;
    fields: DotnetAdvancedFieldModel[];
    collapsedFields: DotnetAdvancedFieldModel[];
    readOnly: boolean;
    onParameterChange: (key: string, value: ParameterValue) => void;
  }): ReactNode | null {
    if (fields.length === 0 && collapsedFields.length === 0) {
      return null;
    }

    return (
      <SectionShell
        icon={FileCog}
        title={profileT.quickCreateAdvancedSection || "高级参数"}
        description={
          collapsedFields.length > 0
            ? readOnly
              ? profileT.quickCreateAdvancedFocusedReadonlyDescription ||
                "基础字段已直接展示，其余参数默认折叠；展开后可查看剩余参数。"
              : profileT.quickCreateAdvancedFocusedDescription ||
                "常用高级字段直接展示，其余参数默认折叠；展开后可继续补充剩余参数。"
            : profileT.quickCreateAdvancedSectionDescription ||
              "补充框架、日志和 MSBuild 属性，覆盖更多发布场景。"
        }
      >
        <div className="space-y-4">
          {fields.length > 0 ? (
            <DotnetAdvancedFieldCards
              profileT={profileT}
              fields={fields}
              readOnly={readOnly}
              onParameterChange={onParameterChange}
            />
          ) : null}
          <DotnetCollapsedReadonlyAdvancedFields
            profileT={profileT}
            fields={collapsedFields}
            readOnly={readOnly}
            onParameterChange={onParameterChange}
          />
        </div>
      </SectionShell>
    );
  }
);

function DotnetAdvancedFieldControl({
  field,
  fieldText,
  profileT,
  readOnly,
  align = "left",
  onChange,
}: {
  field: DotnetAdvancedFieldModel;
  fieldText: LocalizedAdvancedFieldText;
  profileT: FormTranslations;
  readOnly: boolean;
  align?: "left" | "right";
  onChange: (value: ParameterValue) => void;
}): ReactNode {
  switch (field.control) {
    case "framework-suggestions":
      return (
        <DotnetFrameworkSuggestionsField
          field={field}
          fieldText={fieldText}
          readOnly={readOnly}
          align={align}
          onChange={onChange}
        />
      );
    case "select":
      return (
        <DotnetSelectField
          field={field}
          fieldText={fieldText}
          profileT={profileT}
          readOnly={readOnly}
          align={align}
          onChange={onChange}
        />
      );
    case "boolean":
      return (
        <DotnetBooleanField
          field={field}
          fieldText={fieldText}
          readOnly={readOnly}
          align={align}
          onChange={onChange}
        />
      );
    case "property-map":
      return (
        <DotnetPropertyTableField
          field={field}
          fieldText={fieldText}
          readOnly={readOnly}
          align={align}
          onChange={onChange}
        />
      );
    case "string":
    default:
      return (
        <DotnetStringField
          field={field}
          fieldText={fieldText}
          readOnly={readOnly}
          align={align}
          onChange={onChange}
        />
      );
  }
}

function DotnetFrameworkSuggestionsField({
  field,
  fieldText,
  readOnly,
  align = "left",
  onChange,
}: {
  field: DotnetAdvancedFieldModel;
  fieldText: LocalizedAdvancedFieldText;
  readOnly: boolean;
  align?: "left" | "right";
  onChange: (value: ParameterValue) => void;
}): ReactNode {
  const value = typeof field.value === "string" ? field.value : "";
  const datalistId = `framework-options-${field.key}`;

  return (
    <div className="space-y-1.5 w-full">
      <div className="flex flex-wrap items-center gap-1.5">
        <Label htmlFor={field.key} className="text-xs font-semibold text-foreground">
          {fieldText.label}
        </Label>
        {fieldText.technicalLabel && (
          <span className="font-mono text-[9px] text-[hsl(var(--text-fine))] bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 px-1.5 py-0.5 rounded-md">
            {fieldText.technicalLabel}
          </span>
        )}
        <HelpTip
          align={align === "right" ? "end" : "start"}
          text={fieldText.description}
        />
      </div>
      <Input
        id={field.key}
        aria-label={fieldText.label}
        list={readOnly ? undefined : datalistId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={fieldText.inputPlaceholder}
        readOnly={readOnly}
        className="h-9 text-xs"
      />
      {!readOnly && field.options && field.options.length > 0 ? (
        <datalist id={datalistId}>
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </datalist>
      ) : null}
    </div>
  );
}

function DotnetSelectField({
  field,
  fieldText,
  profileT,
  readOnly,
  align = "left",
  onChange,
}: {
  field: DotnetAdvancedFieldModel;
  fieldText: LocalizedAdvancedFieldText;
  profileT: FormTranslations;
  readOnly: boolean;
  align?: "left" | "right";
  onChange: (value: ParameterValue) => void;
}): ReactNode {
  const value = typeof field.value === "string" ? field.value : "";
  const options = getLocalizedSelectOptions(profileT, field);

  return (
    <div className="space-y-1.5 w-full">
      <div className="flex flex-wrap items-center gap-1.5">
        <Label htmlFor={field.key} className="text-xs font-semibold text-foreground">
          {fieldText.label}
        </Label>
        {fieldText.technicalLabel && (
          <span className="font-mono text-[9px] text-[hsl(var(--text-fine))] bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 px-1.5 py-0.5 rounded-md">
            {fieldText.technicalLabel}
          </span>
        )}
        <HelpTip
          align={align === "right" ? "end" : "start"}
          text={fieldText.description}
        />
      </div>
      <Select
        value={value || EMPTY_SELECT_VALUE}
        onValueChange={(nextValue) =>
          onChange(nextValue === EMPTY_SELECT_VALUE ? "" : nextValue)
        }
      >
        <SelectTrigger
          id={field.key}
          aria-label={fieldText.label}
          disabled={readOnly}
          className="h-9 text-xs"
        >
          <SelectValue placeholder={fieldText.emptyOptionLabel} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={EMPTY_SELECT_VALUE} className="text-xs">
            {fieldText.emptyOptionLabel}
          </SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} className="text-xs">
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function DotnetBooleanField({
  field,
  fieldText,
  readOnly,
  align = "left",
  onChange,
}: {
  field: DotnetAdvancedFieldModel;
  fieldText: LocalizedAdvancedFieldText;
  readOnly: boolean;
  align?: "left" | "right";
  onChange: (value: ParameterValue) => void;
}): ReactNode {
  const checked = field.value === true;

  return (
    <div className="flex items-center justify-between gap-4 h-full w-full py-0.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-foreground">
          <span>{fieldText.label}</span>
          {fieldText.technicalLabel && (
            <span className="font-mono text-[9px] text-[hsl(var(--text-fine))] bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 px-1.5 py-0.5 rounded-md animate-fade-in">
              {fieldText.technicalLabel}
            </span>
          )}
          <HelpTip
            align={align === "right" ? "end" : "start"}
            text={fieldText.description}
          />
        </div>
      </div>
      <Switch
        aria-label={fieldText.label}
        checked={checked}
        onCheckedChange={(nextChecked) => onChange(nextChecked)}
        disabled={readOnly}
      />
    </div>
  );
}

function DotnetStringField({
  field,
  fieldText,
  readOnly,
  align = "left",
  onChange,
}: {
  field: DotnetAdvancedFieldModel;
  fieldText: LocalizedAdvancedFieldText;
  readOnly: boolean;
  align?: "left" | "right";
  onChange: (value: ParameterValue) => void;
}): ReactNode {
  const value = typeof field.value === "string" ? field.value : "";

  return (
    <div className="space-y-1.5 w-full">
      <div className="flex flex-wrap items-center gap-1.5">
        <Label htmlFor={field.key} className="text-xs font-semibold text-foreground">
          {fieldText.label}
        </Label>
        {fieldText.technicalLabel && (
          <span className="font-mono text-[9px] text-[hsl(var(--text-fine))] bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 px-1.5 py-0.5 rounded-md">
            {fieldText.technicalLabel}
          </span>
        )}
        <HelpTip
          align={align === "right" ? "end" : "start"}
          text={fieldText.description}
        />
      </div>
      <Input
        id={field.key}
        aria-label={fieldText.label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        readOnly={readOnly}
        placeholder={fieldText.inputPlaceholder}
        className="h-9 text-xs"
      />
    </div>
  );
}

function DotnetPropertyTableField({
  field,
  fieldText,
  readOnly,
  align = "left",
  onChange,
}: {
  field: DotnetAdvancedFieldModel;
  fieldText: LocalizedAdvancedFieldText;
  readOnly: boolean;
  align?: "left" | "right";
  onChange: (value: ParameterValue) => void;
}): ReactNode {
  const properties = normalizeDotnetPropertyMap(field.value);
  const entries = Object.entries(properties);

  const updateKey = useCallback(
    (currentKey: string, nextKey: string) => {
      if (readOnly) {
        return;
      }

      const nextEntries = entries.map(([key, value]) =>
        key === currentKey ? [nextKey, value] : [key, value]
      );
      onChange(Object.fromEntries(nextEntries));
    },
    [entries, onChange, readOnly]
  );

  const updateValue = useCallback(
    (targetKey: string, nextValue: string) => {
      if (readOnly) {
        return;
      }

      onChange({
        ...properties,
        [targetKey]: nextValue,
      });
    },
    [onChange, properties, readOnly]
  );

  const removeEntry = useCallback(
    (targetKey: string) => {
      if (readOnly) {
        return;
      }

      const nextProperties = { ...properties };
      delete nextProperties[targetKey];
      onChange(nextProperties);
    },
    [onChange, properties, readOnly]
  );

  const addEntry = useCallback(() => {
    if (readOnly) {
      return;
    }

    const nextKey = createDraftPropertyKey(properties);
    onChange({
      ...properties,
      [nextKey]: "",
    });
  }, [onChange, properties, readOnly]);

  return (
    <div className="space-y-2 w-full">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Label className="text-xs font-semibold text-foreground">{fieldText.label}</Label>
            {fieldText.technicalLabel && (
              <span className="font-mono text-[9px] text-[hsl(var(--text-fine))] bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 px-1.5 py-0.5 rounded-md">
                {fieldText.technicalLabel}
              </span>
            )}
            <HelpTip
              align={align === "right" ? "end" : "start"}
              text={fieldText.propertiesHint}
            />
          </div>
        </div>
        {!readOnly ? (
          <Button type="button" variant="outline" size="sm" onClick={addEntry} className="h-8 text-xs">
            <Plus className="mr-1.5 size-3.5" />
            {fieldText.propertiesAddLabel}
          </Button>
        ) : null}
      </div>

      {entries.length > 0 ? (
        <div className="space-y-1.5">
          <div className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)_auto] gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span>{fieldText.propertyKeyColumnLabel}</span>
            <span>{fieldText.propertyValueColumnLabel}</span>
            <span className="sr-only">Actions</span>
          </div>
          {entries.map(([key, value], index) => (
            <div
              key={key}
              className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)_auto] gap-1.5 items-center"
            >
              <Input
                aria-label={`${fieldText.label}-${fieldText.propertyKeyColumnLabel}-${index + 1}`}
                value={key}
                onChange={(event) => updateKey(key, event.target.value)}
                readOnly={readOnly}
                placeholder={fieldText.propertyKeyPlaceholder}
                className="h-8 text-xs"
              />
              <Input
                aria-label={`${fieldText.label}-${fieldText.propertyValueColumnLabel}-${index + 1}`}
                value={value}
                onChange={(event) => updateValue(key, event.target.value)}
                readOnly={readOnly}
                placeholder={fieldText.propertyValuePlaceholder}
                className="h-8 text-xs"
              />
              {!readOnly ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 text-destructive hover:text-destructive"
                  aria-label={formatTemplate(fieldText.removePropertyLabel, {
                    value: key,
                  })}
                  onClick={() => removeEntry(key)}
                >
                  <X className="size-3.5" />
                </Button>
              ) : (
                <div className="w-8" />
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-input px-2.5 py-2 text-xs leading-4 text-muted-foreground">
          {fieldText.propertiesEmptyText}
        </div>
      )}
    </div>
  );
}

export function DotnetPublishConfigFormSections({
  mode = "edit",
  presentation = "standard",
  profileT,
  appT,
  config,
  dotnetSchema,
  projectFrameworkOptions = EMPTY_PROJECT_FRAMEWORK_OPTIONS,
  onDraftChange,
}: DotnetPublishConfigFormSectionsProps): ReactNode {
  const readOnly = mode === "readonly";
  const focusedPresentation = presentation === "focused";
  const isRuntimeRequired = !config.runtime;

  const updateDraft = useCallback(
    (patch: Partial<PublishConfigStore>) => {
      if (readOnly) {
        return;
      }

      onDraftChange?.(patch);
    },
    [onDraftChange, readOnly]
  );

  const handleConfigurationChange = useCallback(
    (value: string) => {
      updateDraft({ configuration: value });
    },
    [updateDraft]
  );

  const handleRuntimeChange = useCallback(
    (value: string) => {
      updateDraft({ runtime: value === "none" ? "" : value });
    },
    [updateDraft]
  );

  const handleOutputDirChange = useCallback(
    (value: string) => {
      updateDraft({ outputDir: value });
    },
    [updateDraft]
  );

  const handleSelfContainedChange = useCallback(
    (checked: boolean) => {
      updateDraft({ selfContained: checked });
    },
    [updateDraft]
  );

  const advancedFieldsModel = useMemo(
    () =>
      buildDotnetAdvancedFieldsModel({
        config,
        dotnetSchema,
        projectFrameworkOptions,
      }),
    [config, dotnetSchema, projectFrameworkOptions]
  );

  const handleAdvancedParameterChange = useCallback(
    (key: string, value: ParameterValue) => {
      if (readOnly) {
        return;
      }

      const field = advancedFieldsModel.fieldMap.get(key);
      if (!field) {
        return;
      }

      if (field.source.kind === "draft") {
        switch (field.source.draftKey) {
          case "framework":
            updateDraft({ framework: typeof value === "string" ? value : "" });
            return;
          case "verbosity":
            updateDraft({ verbosity: typeof value === "string" ? value : "" });
            return;
          case "noBuild":
            updateDraft({ noBuild: value === true });
            return;
          case "noRestore":
            updateDraft({ noRestore: value === true });
            return;
          case "noLogo":
            updateDraft({ noLogo: value === true });
            return;
          case "deleteExistingFiles":
            updateDraft({ deleteExistingFiles: value === true });
            return;
        }
      }

      if (field.source.kind === "property") {
        const nextProperties = { ...config.properties };
        if (field.source.valueType === "boolean") {
          if (value === true) {
            nextProperties[field.source.propertyKey] = "true";
          } else {
            delete nextProperties[field.source.propertyKey];
          }
        } else {
          const nextValue = typeof value === "string" ? value.trim() : "";
          if (!nextValue) {
            delete nextProperties[field.source.propertyKey];
          } else {
            nextProperties[field.source.propertyKey] = nextValue;
          }
        }

        updateDraft({ properties: nextProperties });
        return;
      }

      if (field.source.kind === "properties") {
        const excludedKeys = new Set(field.source.excludedPropertyKeys);
        const preservedFixedProperties = Object.fromEntries(
          Object.entries(config.properties).filter(([propertyKey]) =>
            excludedKeys.has(propertyKey)
          )
        );

        updateDraft({
          properties: {
            ...preservedFixedProperties,
            ...normalizeDotnetPropertyMap(value),
          },
        });
      }
    },
    [advancedFieldsModel.fieldMap, config.properties, readOnly, updateDraft]
  );

  return (
    <>
      <DotnetPublishParametersSection
        profileT={profileT}
        appT={appT}
        configuration={config.configuration}
        runtime={config.runtime}
        readOnly={readOnly}
        onConfigurationChange={handleConfigurationChange}
        onRuntimeChange={handleRuntimeChange}
      />

      <DotnetPublishOutputSection
        profileT={profileT}
        appT={appT}
        outputDir={config.outputDir}
        selfContained={config.selfContained}
        isRuntimeRequired={isRuntimeRequired}
        readOnly={readOnly}
        onOutputDirChange={handleOutputDirChange}
        onSelfContainedChange={handleSelfContainedChange}
      />

      <DotnetPublishAdvancedParametersSection
        profileT={profileT}
        fields={
          focusedPresentation
            ? advancedFieldsModel.baseFields
            : advancedFieldsModel.allFields
        }
        collapsedFields={
          focusedPresentation
            ? advancedFieldsModel.collapsedFields
            : EMPTY_ADVANCED_FIELDS
        }
        readOnly={readOnly}
        onParameterChange={handleAdvancedParameterChange}
      />
    </>
  );
}

function createDraftPropertyKey(properties: Record<string, string>): string {
  let index = Object.keys(properties).length + 1;
  while (properties[`Property${index}`] !== undefined) {
    index += 1;
  }

  return `Property${index}`;
}
