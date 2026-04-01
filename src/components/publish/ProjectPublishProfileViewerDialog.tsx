import { useMemo } from "react";
import { Eye, FileCode2, RefreshCw } from "lucide-react";

import { DotnetPublishConfigFormSections } from "@/components/publish/DotnetPublishConfigFormSections";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { AppDialogInset } from "@/components/ui/app-dialog-inset";
import { AppDialogShell } from "@/components/ui/app-dialog-shell";
import { SectionShell } from "@/components/ui/section-shell";
import {
  buildProjectPublishProfileSupplementSections,
  type ProjectPublishProfileSupplementSection,
} from "@/lib/dotnetPublishProfileViewer";
import type { ParsedProjectPublishProfile } from "@/lib/projectPublishProfileXml";
import type { PublishConfigStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { ParameterSchema } from "@/types/parameters";

type ViewerTranslations = Record<string, string | undefined>;

export type ProjectProfileViewerState =
  | {
      status: "idle";
      profileName: null;
    }
  | {
      status: "loading";
      profileName: string;
    }
  | {
      status: "ready";
      profileName: string;
      filePath: string;
      editableConfig: PublishConfigStore;
      parsedProfile: ParsedProjectPublishProfile;
    }
  | {
      status: "error";
      profileName: string;
      errorMessage: string;
    };

interface ProjectPublishProfileViewerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  viewerState: ProjectProfileViewerState;
  dotnetSchema?: ParameterSchema;
  projectFrameworkOptions?: string[];
  profileT: ViewerTranslations;
  appT: ViewerTranslations;
  configPanelT: ViewerTranslations;
}

export function ProjectPublishProfileViewerDialog({
  open,
  onOpenChange,
  viewerState,
  dotnetSchema,
  projectFrameworkOptions = [],
  profileT,
  appT,
  configPanelT,
}: ProjectPublishProfileViewerDialogProps): JSX.Element {
  const t = configPanelT;
  const supplementSections = useMemo(() => {
    if (viewerState.status !== "ready") {
      return [];
    }

    return buildProjectPublishProfileSupplementSections(viewerState.parsedProfile);
  }, [viewerState]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AppDialogShell
        size="wide"
        title={t.viewConfigTitle || "查看发布配置"}
        description={
          viewerState.profileName
            ? `${
                t.viewConfigDescription ||
                "查看项目发布配置文件中的全部参数。"
              } · ${viewerState.profileName}`
            : t.viewConfigDescription ||
              "查看项目发布配置文件中的全部参数。"
        }
        icon={<Eye className="h-4 w-4" />}
        bodyInnerClassName="max-h-[70vh] space-y-4 pr-1"
        footer={
          <div className="flex w-full justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t.close || "关闭"}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {viewerState.status === "loading" ? (
            <div className="flex min-h-40 items-center justify-center rounded-2xl border border-dashed border-border/70 bg-muted/20 text-sm text-muted-foreground">
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              {t.loadingConfig || "正在加载配置..."}
            </div>
          ) : null}

          {viewerState.status === "error" ? (
            <AppDialogInset className="border-destructive/30 bg-destructive/5 text-sm text-destructive shadow-none">
              {viewerState.errorMessage}
            </AppDialogInset>
          ) : null}

          {viewerState.status === "ready" ? (
            <>
              <AppDialogInset>
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t.configFilePath || "配置文件路径"}
                </div>
                <div className="mt-2 break-all font-mono text-xs text-foreground/80">
                  {viewerState.filePath}
                </div>
              </AppDialogInset>

              <AppDialogInset className="text-xs leading-5 text-muted-foreground">
                {t.viewConfigFocusedHint ||
                  "主表单与新建、编辑配置保持一致；其余无法在表单里完整表达的 .pubxml 信息收起在下方补充区中。"}
              </AppDialogInset>

              <DotnetPublishConfigFormSections
                mode="readonly"
                presentation="focused"
                profileT={profileT}
                appT={appT}
                config={viewerState.editableConfig}
                dotnetSchema={dotnetSchema}
                projectFrameworkOptions={projectFrameworkOptions}
              />

              {supplementSections.length > 0 ? (
                <ProjectPublishProfileSupplementSectionList
                  sections={supplementSections}
                  translations={t}
                />
              ) : null}
            </>
          ) : null}
        </div>
      </AppDialogShell>
    </Dialog>
  );
}

function ProjectPublishProfileSupplementSectionList({
  sections,
  translations,
}: {
  sections: ProjectPublishProfileSupplementSection[];
  translations: ViewerTranslations;
}): JSX.Element {
  return (
    <SectionShell
      icon={FileCode2}
      title={translations.fullParsedFields || "完整解析参数"}
      description={
        translations.fullParsedFieldsDescription ||
        "包含主表单无法完整表达的结构化 .pubxml 信息，默认折叠以减少噪音。"
      }
      collapsible
      defaultExpanded={false}
      badge={String(sections.length)}
    >
      <div className="space-y-4">
        {sections.map((section) => (
          <ProjectPublishProfileSupplementSectionCard
            key={section.id}
            section={section}
            translations={translations}
          />
        ))}
      </div>
    </SectionShell>
  );
}

function ProjectPublishProfileSupplementSectionCard({
  section,
  translations,
}: {
  section: ProjectPublishProfileSupplementSection;
  translations: ViewerTranslations;
}): JSX.Element {
  const sectionAttributes = Object.entries(section.attributes);

  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground">
              {section.title}
            </div>
            <CardDescription className="mt-1 text-xs leading-5">
              {translations.fullParsedSectionTag || "标签"}: {section.tagName}
            </CardDescription>
          </div>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
            {section.entries.length}
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-0">
        {sectionAttributes.length > 0 ? (
          <ProjectPublishProfileMetadataBlock
            label={
              translations.fullParsedSectionAttributes || "分组属性"
            }
            entries={sectionAttributes}
          />
        ) : null}

        {section.entries.map((entry) => (
          <div
            key={`${section.id}:${entry.path}:${entry.key}`}
            className="space-y-3 rounded-2xl border border-[var(--glass-border-subtle)] bg-[var(--glass-input-bg)] p-4 shadow-[var(--glass-inset-shadow)]"
          >
            <div className="text-sm font-medium text-foreground">{entry.key}</div>
            <ProjectPublishProfileField
              label={translations.fullParsedEntryPath || "节点路径"}
              value={entry.path}
              emptyLabel={translations.fullParsedEmptyValue || "空值"}
            />
            <ProjectPublishProfileField
              label={translations.fullParsedEntryValue || "节点值"}
              value={entry.value}
              emptyLabel={translations.fullParsedEmptyValue || "空值"}
            />
            {Object.keys(entry.attributes).length > 0 ? (
              <ProjectPublishProfileMetadataBlock
                label={
                  translations.fullParsedEntryAttributes || "节点属性"
                }
                entries={Object.entries(entry.attributes)}
              />
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ProjectPublishProfileMetadataBlock({
  label,
  entries,
}: {
  label: string;
  entries: Array<[string, string]>;
}): JSX.Element {
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="space-y-2">
        {entries.map(([key, value]) => (
          <div
            key={`${label}:${key}`}
            className="grid gap-2 rounded-xl border border-border/60 bg-muted/20 px-3 py-2 sm:grid-cols-[minmax(0,140px)_1fr]"
          >
            <div className="text-xs font-medium text-foreground/80">{key}</div>
            <div className="break-all font-mono text-xs text-foreground/80">
              {value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProjectPublishProfileField({
  label,
  value,
  emptyLabel,
}: {
  label: string;
  value: string;
  emptyLabel: string;
}): JSX.Element {
  const hasValue = value.trim().length > 0;

  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "break-all rounded-xl border border-border/60 bg-muted/20 px-3 py-2 font-mono text-xs text-foreground/80",
          !hasValue && "italic text-muted-foreground"
        )}
      >
        {hasValue ? value : emptyLabel}
      </div>
    </div>
  );
}
