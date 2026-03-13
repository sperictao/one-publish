import { Check, Loader2, Save } from "lucide-react";

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[840px] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{profileT.quickCreateTitle || "创建发布配置"}</DialogTitle>
          <DialogDescription>
            {profileT.quickCreateDescription || "填写与自定义模式一致的参数并保存为发布配置。"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto">
          <fieldset className="space-y-2.5">
            <Label>{profileT.quickCreateTemplate || "预置模板"}</Label>
            <div className="grid max-h-[240px] grid-cols-2 gap-2 overflow-y-auto pr-1 md:grid-cols-4">
              {quickCreateTemplateOptions.map((option) => {
                const isSelected = quickCreateTemplateId === option.id;

                return (
                  <label
                    key={`quick-template-${option.id}`}
                    title={
                      option.description
                        ? `${option.name} - ${option.description}`
                        : option.name
                    }
                    className={cn(
                      "group relative flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 transition-all duration-150",
                      isSelected
                        ? "border-primary/45 bg-primary/10 shadow-[0_6px_16px_hsl(var(--primary)/0.12)]"
                        : "border-[var(--glass-divider)] bg-[var(--glass-bg)] hover:border-primary/30 hover:bg-[var(--glass-bg-hover)]"
                    )}
                    htmlFor={`quick-template-${option.id}`}
                  >
                    <input
                      id={`quick-template-${option.id}`}
                      type="radio"
                      name="quick-profile-template"
                      className="sr-only"
                      checked={isSelected}
                      onChange={() => onApplyTemplate(option.id)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium leading-5">
                        {option.name}
                      </div>
                      {option.description && (
                        <div className="truncate text-[11px] text-muted-foreground">
                          {option.description}
                        </div>
                      )}
                    </div>
                    <div className="flex items-start">
                      <span
                        className={cn(
                          "mt-0.5 inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border transition-colors duration-200",
                          isSelected
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-[var(--glass-divider)] bg-background/70 text-transparent group-hover:border-primary/45"
                        )}
                      >
                        <Check className="h-3 w-3" />
                      </span>
                    </div>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="space-y-2">
            <Label htmlFor="quick-profile-name">
              {profileT.quickCreateName || "配置名称"}
            </Label>
            <Input
              id="quick-profile-name"
              placeholder={profileT.profileNamePlaceholder || "输入配置文件名称"}
              value={quickCreateProfileName}
              onChange={(event) => onProfileNameChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !quickCreateProfileSaving) {
                  event.preventDefault();
                  onSave();
                }
              }}
            />
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
                  <SelectItem key={`quick-profile-group-${group}`} value={group}>
                    {group}
                  </SelectItem>
                ))}
                <SelectItem value={quickCreateGroupCustomValue}>
                  {profileT.quickCreateGroupCustom || "自定义分组"}
                </SelectItem>
              </SelectContent>
            </Select>
            {quickCreateProfileGroup === quickCreateGroupCustomValue && (
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
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="quick-profile-configuration">
                {appT.configurationType || "配置类型"}
              </Label>
              <Select
                value={quickCreateProfileDraft.configuration}
                onValueChange={(value) => onDraftChange({ configuration: value })}
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
                  onDraftChange({ runtime: value === "none" ? "" : value })
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
            </div>

            <div className="col-span-2 space-y-2">
              <Label htmlFor="quick-profile-output">
                {appT.outputDirLabel || "输出目录"}
              </Label>
              <Input
                id="quick-profile-output"
                value={quickCreateProfileDraft.outputDir}
                onChange={(event) => onDraftChange({ outputDir: event.target.value })}
                placeholder={appT.outputDirPlaceholder || "留空使用默认目录"}
              />
            </div>

            <div className="col-span-2 flex items-center gap-2">
              <Switch
                id="quick-profile-self-contained"
                checked={quickCreateProfileDraft.selfContained}
                onCheckedChange={(checked) =>
                  onDraftChange({ selfContained: checked })
                }
                disabled={!quickCreateProfileDraft.runtime}
              />
              <Label htmlFor="quick-profile-self-contained">
                {appT.selfContained || "自包含部署"}
              </Label>
            </div>
          </div>
        </div>

        <DialogFooter>
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
            disabled={quickCreateProfileSaving || !quickCreateProfileName.trim()}
          >
            {quickCreateProfileSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {profileT.quickCreateSaving || "保存中..."}
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                {profileT.quickCreateAction || "创建并保存"}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
