import { Suspense, lazy } from "react";
import { OutputLogCard, type OutputLogCardProps } from "@/components/publish/OutputLogCard";
import type { CommandImportResultCardProps } from "@/components/publish/CommandImportResultCard";
import type { DiagnosticsSectionProps } from "@/components/publish/DiagnosticsSection";
import type { DotnetPublishEditorCardProps } from "@/components/publish/DotnetPublishEditorCard";

const CommandImportResultCard = lazy(async () => {
  const mod = await import("@/components/publish/CommandImportResultCard");
  return { default: mod.CommandImportResultCard };
});

const DotnetPublishEditorCard = lazy(async () => {
  const mod = await import("@/components/publish/DotnetPublishEditorCard");
  return { default: mod.DotnetPublishEditorCard };
});

const DiagnosticsSection = lazy(async () => {
  const mod = await import("@/components/publish/DiagnosticsSection");
  return { default: mod.DiagnosticsSection };
});

export interface PublishContentSectionProps {
  showCommandImportResultCard: boolean;
  commandImportResultCardProps: CommandImportResultCardProps | null;
  outputLogCardProps: OutputLogCardProps;
  dotnetPublishEditorCardProps: DotnetPublishEditorCardProps | null;
  shouldLoadDiagnosticsSection: boolean;
  diagnosticsSectionProps: DiagnosticsSectionProps | null;
  rightPanelView: "home" | "history";
}

export function PublishContentSection({
  showCommandImportResultCard,
  commandImportResultCardProps,
  outputLogCardProps,
  dotnetPublishEditorCardProps,
  shouldLoadDiagnosticsSection,
  diagnosticsSectionProps,
  rightPanelView,
}: PublishContentSectionProps) {
  const hasOutputLogCard =
    Boolean(outputLogCardProps.outputLog) ||
    outputLogCardProps.publishResult !== null ||
    outputLogCardProps.publishControls !== null;

  return (
    <div className="flex min-h-full flex-col gap-6 p-6">
      {showCommandImportResultCard && commandImportResultCardProps && (
        <div className="mx-auto w-full max-w-3xl">
          <Suspense fallback={null}>
            <CommandImportResultCard {...commandImportResultCardProps} />
          </Suspense>
        </div>
      )}
      {rightPanelView === "home" ? (
        <>
          {dotnetPublishEditorCardProps && (
            <div className="mx-auto w-full max-w-3xl">
              <Suspense fallback={null}>
                <DotnetPublishEditorCard {...dotnetPublishEditorCardProps} />
              </Suspense>
            </div>
          )}
          {hasOutputLogCard && (
            <div className="flex min-h-0 flex-1 flex-col">
              <OutputLogCard {...outputLogCardProps} />
            </div>
          )}
        </>
      ) : null}
      {shouldLoadDiagnosticsSection && diagnosticsSectionProps && (
        <Suspense fallback={null}>
          <DiagnosticsSection {...diagnosticsSectionProps} />
        </Suspense>
      )}
    </div>
  );
}
