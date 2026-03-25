import { Suspense, lazy } from "react";
import { OutputLogCard, type OutputLogCardProps } from "@/components/publish/OutputLogCard";
import type { CommandImportResultCardProps } from "@/components/publish/CommandImportResultCard";
import type { DiagnosticsSectionProps } from "@/components/publish/DiagnosticsSection";

const CommandImportResultCard = lazy(async () => {
  const mod = await import("@/components/publish/CommandImportResultCard");
  return { default: mod.CommandImportResultCard };
});

const DiagnosticsSection = lazy(async () => {
  const mod = await import("@/components/publish/DiagnosticsSection");
  return { default: mod.DiagnosticsSection };
});

export interface PublishContentSectionProps {
  showCommandImportResultCard: boolean;
  commandImportResultCardProps: CommandImportResultCardProps | null;
  outputLogCardProps: OutputLogCardProps;
  shouldLoadDiagnosticsSection: boolean;
  diagnosticsSectionProps: DiagnosticsSectionProps | null;
  rightPanelView: "home" | "history";
}

export function PublishContentSection({
  showCommandImportResultCard,
  commandImportResultCardProps,
  outputLogCardProps,
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
