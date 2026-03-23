import {
  FolderOutput,
  Layers3,
  Loader2,
  Save,
  SlidersHorizontal,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
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
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

interface QuickCreateProfileDraft {
  configuration: string;
  runtime: string;
  outputDir: string;
  selfContained: boolean;
}

interface QuickCreateTemplateOption {
  id: string;
  name: string;
  description?: string;
}

interface QuickCreateProfileDialogProps {
  open: boolean;
  quickCreateProfileOpen: boolean;
  quickCreateTemplateId: string;
  quickCreateTemplateOptions: QuickCreateTemplateOption[];
  quickCreateProfileName: string;
  quickCreateProfileGroup: string;
  quickCreateProfileGroupOptions: string[];
  quickCreateProfileCustomGroup: string;
  quickCreateProfileDraft: QuickCreateProfileDraft;
  quickCreateProfileSaving: boolean;
  quickCreateEditing: boolean;
  quickCreateGroupDefaultValue: string;
  quickCreateGroupCustomValue: string;
  profileT: Record<string, string | undefined>;
  appT: Record<string, string | undefined>;
  cancelLabel: string;
  onOpenChange: (open: boolean) => void;
  onApplyTemplate: (id: string) => void;
  onProfileNameChange: (value: string) => void;
  onProfileGroupChange: (value: string) => void;
  onProfileCustomGroupChange: (value: string) => void;
  onDraftChange: (patch: Partial<QuickCreateProfileDraft>) => void;
  onSave: () => void;
}

function SectionShell({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-[0_8px_20px_hsl(var(--primary)/0.16)]">
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-foreground">{title}</h3>
            <CardDescription className="mt-1 text-xs leading-5">
              {description}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">{children}</CardContent>
    </Card>
  );
}

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!flex max-h-[calc(100vh-16px)] !w-[calc(100vw-16px)] !max-w-[1180px] !flex-col gap-0 overflow-hidden border-[var(--glass-border-subtle)] p-0 sm:max-h-[calc(100vh-32px)] sm:!w-[calc(100vw-32px)]">
        <DialogHeader className="border-b border-[var(--glass-divider)] px-6 pb-5 pt-6 pr-16">
          <div className="flex items-start gap-3">
            <span
              className={cn(
                "mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl shadow-[0_8px_20px_rgba(0,0,0,0.08)]",
                quickCreateEditing
                  ? "bg-[var(--glass-input-bg)] text-foreground/75"
                  : "bg-primary/10 text-primary"
              )}
            >
              {quickCreateEditing ? (
                <Layers3 className="h-4 w-4" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-[18px] font-semibold tracking-tight">
                {quickCreateEditing
                  ? profileT.quickEditTitle || "编辑发布配置"
                  : profileT.quickCreateTitle || "创建发布配置"}
              </DialogTitle>
              <DialogDescription className="mt-1 pr-2 leading-6">
                {quickCreateEditing
                  ? profileT.quickEditDescription || "修改发布配置后保存更新。"
                  : profileT.quickCreateDescription ||
                    "填写与自定义模式一致的参数并保存为发布配置。"}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="glass-scrollbar min-h-0 flex-1 overflow-y-auto">
          <div className="space-y-5 p-5 sm:p-6">
              <Card className="rounded-2xl">
                <CardHeader className="pb-3">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-base font-semibold text-foreground">
                        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary shadow-[var(--glass-inset-shadow)]">
                          <Sparkles className="h-4 w-4" />
                        </span>
                        {profileT.quickCreateTemplateCompactTitle ||
                          "快速套用模板"}
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
                {selectedTemplate?.description ? (
                  <CardContent className="pt-0">
                    <div className="rounded-xl border border-[var(--glass-border-subtle)] bg-[var(--glass-input-bg)] px-3 py-2.5 text-xs leading-5 text-muted-foreground">
                      {selectedTemplate.description}
                    </div>
                  </CardContent>
                ) : null}
              </Card>

              <SectionShell
                icon={Layers3}
                title={
                  profileT.quickCreateBasicSection || "基础信息"
                }
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
                      onChange={(event) =>
                        onProfileNameChange(event.target.value)
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !quickCreateProfileSaving) {
                          event.preventDefault();
                          onSave();
                        }
                      }}
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

              <SectionShell
                icon={SlidersHorizontal}
                title={
                  profileT.quickCreateParametersSection || "发布参数"
                }
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
                      value={quickCreateProfileDraft.configuration}
                      onValueChange={(value) =>
                        onDraftChange({ configuration: value })
                      }
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
                    <Select
                      value={quickCreateProfileDraft.runtime || "none"}
                      onValueChange={(value) =>
                        onDraftChange({
                          runtime: value === "none" ? "" : value,
                        })
                      }
                    >
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
                      value={quickCreateProfileDraft.outputDir}
                      onChange={(event) =>
                        onDraftChange({ outputDir: event.target.value })
                      }
                      placeholder={
                        appT.outputDirPlaceholder || "留空使用默认目录"
                      }
                    />
                    <p className="text-xs leading-5 text-muted-foreground">
                      {profileT.quickCreateOutputHint ||
                        "留空时会回落到默认输出目录规则。"}
                    </p>
                  </div>

                  <div
                    className={cn(
                      "rounded-2xl border border-[var(--glass-border-subtle)] bg-background/45 p-4 shadow-[var(--glass-inset-shadow)]",
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
                        checked={quickCreateProfileDraft.selfContained}
                        onCheckedChange={(checked) =>
                          onDraftChange({ selfContained: checked })
                        }
                        disabled={isRuntimeRequired}
                      />
                    </div>
                  </div>
                </div>
              </SectionShell>
          </div>
        </div>

        <DialogFooter className="border-t border-[var(--glass-divider)] px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:space-x-0">
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
              disabled={
                quickCreateProfileSaving || !quickCreateProfileName.trim()
              }
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
