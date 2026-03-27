import { useCallback, useMemo } from "react";
import { SlidersHorizontal } from "lucide-react";

import { DotnetAdvancedParametersSection } from "@/components/publish/DotnetAdvancedParametersSection";
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
import {
  buildDotnetAdvancedParameters,
  createDotnetPublishConfigPatchFromParameter,
} from "@/lib/dotnetPublishConfig";
import type { PublishConfigStore } from "@/lib/store";
import type { ParameterSchema, ParameterValue } from "@/types/parameters";
import { cn } from "@/lib/utils";

type TranslationMap = Record<string, string | undefined>;

export interface DotnetPublishEditorCardProps {
  appT: TranslationMap;
  configT: TranslationMap;
  profileT: TranslationMap;
  dotnetSchema?: ParameterSchema;
  config: PublishConfigStore;
  sourceLabel: string;
  onConfigChange: (updates: Partial<PublishConfigStore>) => void;
}

export function DotnetPublishEditorCard({
  appT,
  configT,
  profileT,
  dotnetSchema,
  config,
  sourceLabel,
  onConfigChange,
}: DotnetPublishEditorCardProps) {
  const isRuntimeRequired = !config.runtime.trim();

  const handleConfigurationChange = useCallback(
    (value: string) => {
      onConfigChange({ configuration: value });
    },
    [onConfigChange]
  );

  const handleRuntimeChange = useCallback(
    (value: string) => {
      if (value === "none") {
        onConfigChange({
          runtime: "",
          selfContained: false,
        });
        return;
      }

      onConfigChange({ runtime: value });
    },
    [onConfigChange]
  );

  const handleOutputDirChange = useCallback(
    (value: string) => {
      onConfigChange({ outputDir: value });
    },
    [onConfigChange]
  );

  const handleSelfContainedChange = useCallback(
    (checked: boolean) => {
      onConfigChange({ selfContained: checked });
    },
    [onConfigChange]
  );

  const advancedParameters = useMemo(
    () => buildDotnetAdvancedParameters(config),
    [config]
  );

  const handleAdvancedParameterChange = useCallback(
    (key: string, value: ParameterValue) => {
      const patch = createDotnetPublishConfigPatchFromParameter(key, value);
      if (patch) {
        onConfigChange(patch);
      }
    },
    [onConfigChange]
  );

  return (
    <div className="space-y-5">
      <SectionShell
        icon={SlidersHorizontal}
        title={appT.publishParameterEditorTitle || "执行参数"}
        description={
          appT.publishParameterEditorDescription ||
          "直接调整当前执行发布的参数，修改后会立即同步到命令预览。"
        }
      >
        <div className="space-y-4">
          <div className="rounded-2xl border border-[var(--glass-border-subtle)] bg-[var(--glass-input-bg)] px-4 py-3 shadow-[var(--glass-inset-shadow)]">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
              {appT.publishParameterSourceLabel || "当前来源"}
            </div>
            <div className="mt-1 text-sm font-medium text-foreground">
              {sourceLabel || configT.customMode || "自定义模式"}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="publish-editor-configuration">
                {appT.configurationType || "配置类型"}
              </Label>
              <Select
                value={config.configuration}
                onValueChange={handleConfigurationChange}
              >
                <SelectTrigger id="publish-editor-configuration">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Release">Release</SelectItem>
                  <SelectItem value="Debug">Debug</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="publish-editor-runtime">
                {appT.runtimeLabel || "运行时"}
              </Label>
              <Select
                value={config.runtime || "none"}
                onValueChange={handleRuntimeChange}
              >
                <SelectTrigger id="publish-editor-runtime">
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
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="publish-editor-output">
                {appT.outputDirLabel || "输出目录"}
              </Label>
              <Input
                id="publish-editor-output"
                value={config.outputDir}
                onChange={(event) => handleOutputDirChange(event.target.value)}
                placeholder={
                  appT.outputDirPlaceholder || "留空使用默认目录"
                }
              />
            </div>

            <div className="md:col-span-2">
              <div
                className={cn(
                  "rounded-2xl border border-[var(--glass-border-subtle)] bg-[var(--glass-input-bg)] p-4 shadow-[var(--glass-inset-shadow)]",
                  isRuntimeRequired && "opacity-90"
                )}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <Label
                      htmlFor="publish-editor-self-contained"
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
                    id="publish-editor-self-contained"
                    checked={config.selfContained}
                    onCheckedChange={handleSelfContainedChange}
                    disabled={isRuntimeRequired}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </SectionShell>

      <DotnetAdvancedParametersSection
        profileT={profileT}
        dotnetSchema={dotnetSchema}
        parameters={advancedParameters}
        onParameterChange={handleAdvancedParameterChange}
      />
    </div>
  );
}
