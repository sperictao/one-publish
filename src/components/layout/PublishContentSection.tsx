import { Suspense, lazy } from "react";
import {
  PublishRunCard,
  type PublishRunCardProps,
} from "@/components/publish/PublishRunCard";
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
  publishRunCardProps: PublishRunCardProps;
  shouldLoadDiagnosticsSection: boolean;
  diagnosticsSectionProps: DiagnosticsSectionProps | null;
  rightPanelView: "home" | "history";
}

export function PublishContentSection({
  showCommandImportResultCard,
  commandImportResultCardProps,
  publishRunCardProps,
  shouldLoadDiagnosticsSection,
  diagnosticsSectionProps,
  rightPanelView,
}: PublishContentSectionProps) {
  const hasPublishRunCard =
    Boolean(publishRunCardProps.isRefreshing) ||
    Boolean(publishRunCardProps.outputLog) ||
    publishRunCardProps.publishResult !== null ||
    publishRunCardProps.publishActions !== null;

  return (
    <div className="flex min-h-full min-w-0 flex-col gap-4 p-4">
      {showCommandImportResultCard && commandImportResultCardProps && (
        <div className="mx-auto w-full max-w-3xl min-w-0">
          <Suspense fallback={null}>
            <CommandImportResultCard {...commandImportResultCardProps} />
          </Suspense>
        </div>
      )}
      {rightPanelView === "home" ? (
        <>
          {hasPublishRunCard && (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <PublishRunCard {...publishRunCardProps} />
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
