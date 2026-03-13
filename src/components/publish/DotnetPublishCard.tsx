import { Import, Loader2, Play, Settings, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

interface DotnetPresetOption {
  id: string;
  name: string;
  description: string;
}

interface DotnetCustomConfig {
  configuration: string;
  runtime: string;
  outputDir: string;
  selfContained: boolean;
}

interface DotnetPublishCardProps {
  configT: Record<string, string | undefined>;
  appT: Record<string, string | undefined>;
  publishT: Record<string, string | undefined>;
  isCustomMode: boolean;
  selectedPreset: string;
  releasePresets: DotnetPresetOption[];
  debugPresets: DotnetPresetOption[];
  projectPublishProfiles: string[];
  customConfig: DotnetCustomConfig;
  dotnetPublishPreviewCommand: string;
  isPublishing: boolean;
  isCancellingPublish: boolean;
  disabled: boolean;
  onOpenCommandImport: () => void;
  onCustomModeChange: (checked: boolean) => void;
  onPresetChange: (value: string) => void;
  onCustomConfigUpdate: (patch: Partial<DotnetCustomConfig>) => void;
  onExecutePublish: () => void;
  onCancelPublish: () => void;
}

export function DotnetPublishCard({
  configT,
  appT,
  publishT,
  isCustomMode,
  selectedPreset,
  releasePresets,
  debugPresets,
  projectPublishProfiles,
  customConfig,
  dotnetPublishPreviewCommand,
  isPublishing,
  isCancellingPublish,
  disabled,
  onOpenCommandImport,
  onCustomModeChange,
  onPresetChange,
  onCustomConfigUpdate,
  onExecutePublish,
  onCancelPublish,
}: DotnetPublishCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Settings className="h-5 w-5" />
              {configT.title || "发布配置"}
            </CardTitle>
            <CardDescription>
              {configT.description || "选择预设配置或自定义发布参数"}
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onOpenCommandImport}
            disabled={disabled}
          >
            <Import className="h-4 w-4 mr-1" />
            {appT.importFromCommand || "从命令导入"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <Label htmlFor="custom-mode">{configT.customMode || "自定义模式"}</Label>
          <Switch
            id="custom-mode"
            checked={isCustomMode}
            onCheckedChange={onCustomModeChange}
          />
        </div>

        {!isCustomMode ? (
          <div className="space-y-2">
            <Label>{configT.presets || "选择预设配置"}</Label>
            <Select value={selectedPreset} onValueChange={onPresetChange}>
              <SelectTrigger>
                <SelectValue placeholder={appT.selectPublishConfig || "选择发布配置"} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>{appT.releaseConfigs || "Release 配置"}</SelectLabel>
                  {releasePresets.map((preset) => (
                    <SelectItem key={preset.id} value={preset.id}>
                      <div className="flex flex-col">
                        <span>{preset.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {preset.description}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel>{appT.debugConfigs || "Debug 配置"}</SelectLabel>
                  {debugPresets.map((preset) => (
                    <SelectItem key={preset.id} value={preset.id}>
                      <div className="flex flex-col">
                        <span>{preset.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {preset.description}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectGroup>
                {projectPublishProfiles.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>{appT.projectPublishProfiles || "项目发布配置"}</SelectLabel>
                    {projectPublishProfiles.map((profile) => (
                      <SelectItem key={`profile-${profile}`} value={`profile-${profile}`}>
                        {profile}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="configuration">{appT.configurationType || "配置类型"}</Label>
              <Select
                value={customConfig.configuration}
                onValueChange={(value) => onCustomConfigUpdate({ configuration: value })}
              >
                <SelectTrigger id="configuration">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Release">Release</SelectItem>
                  <SelectItem value="Debug">Debug</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="runtime">{appT.runtimeLabel || "运行时"}</Label>
              <Select
                value={customConfig.runtime || "none"}
                onValueChange={(value) =>
                  onCustomConfigUpdate({ runtime: value === "none" ? "" : value })
                }
              >
                <SelectTrigger id="runtime">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{appT.frameworkDependent || "框架依赖"}</SelectItem>
                  <SelectItem value="win-x64">Windows x64</SelectItem>
                  <SelectItem value="osx-arm64">macOS ARM64</SelectItem>
                  <SelectItem value="osx-x64">macOS x64</SelectItem>
                  <SelectItem value="linux-x64">Linux x64</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-2 space-y-2">
              <Label htmlFor="output-dir">{appT.outputDirLabel || "输出目录"}</Label>
              <Input
                id="output-dir"
                value={customConfig.outputDir}
                onChange={(event) =>
                  onCustomConfigUpdate({ outputDir: event.target.value })
                }
                placeholder={appT.outputDirPlaceholder || "留空使用默认目录"}
              />
            </div>

            <div className="col-span-2 flex items-center gap-2">
              <Switch
                id="self-contained"
                checked={customConfig.selfContained}
                onCheckedChange={(checked) =>
                  onCustomConfigUpdate({ selfContained: checked })
                }
                disabled={!customConfig.runtime}
              />
              <Label htmlFor="self-contained">{appT.selfContained || "自包含部署"}</Label>
            </div>
          </div>
        )}

        <div className="mt-4 p-3 bg-[var(--glass-input-bg)] rounded-xl border border-[var(--glass-border-subtle)]">
          <div className="text-xs text-muted-foreground mb-2">
            {publishT.command || "将执行的命令:"}
          </div>
          <code className="text-xs font-mono break-all">{dotnetPublishPreviewCommand}</code>
        </div>

        <Button
          className="w-full"
          size="lg"
          onClick={onExecutePublish}
          disabled={disabled || isPublishing}
        >
          {isPublishing ? (
            <>
              <Loader2 className="h-5 w-5 mr-2 animate-spin" />
              {configT.publishing || "发布中..."}
            </>
          ) : (
            <>
              <Play className="h-5 w-5 mr-2" />
              {configT.execute || "执行发布"}
            </>
          )}
        </Button>
        {isPublishing && (
          <Button
            type="button"
            variant="destructive"
            className="w-full"
            onClick={onCancelPublish}
            disabled={isCancellingPublish}
          >
            {isCancellingPublish ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {appT.cancelling || "取消中..."}
              </>
            ) : (
              <>
                <Square className="h-4 w-4 mr-2" />
                {appT.cancelPublish || "取消发布"}
              </>
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
