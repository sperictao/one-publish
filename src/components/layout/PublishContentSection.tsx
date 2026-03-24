import { Suspense, lazy } from "react";
import { OutputLogCard, type OutputLogCardProps } from "@/components/publish/OutputLogCard";
import type { CommandImportResultCardProps } from "@/components/publish/CommandImportResultCard";
import type { FailureGroupDetailCardProps } from "@/components/publish/FailureGroupDetailCard";
import type { FailureGroupsCardProps } from "@/components/publish/FailureGroupsCard";
import type { ExecutionHistoryCardProps } from "@/components/publish/ExecutionHistoryCard";

const CommandImportResultCard = lazy(async () => {
  const mod = await import("@/components/publish/CommandImportResultCard");
  return { default: mod.CommandImportResultCard };
});

const FailureGroupsCard = lazy(async () => {
  const mod = await import("@/components/publish/FailureGroupsCard");
  return { default: mod.FailureGroupsCard };
});

const FailureGroupDetailCard = lazy(async () => {
  const mod = await import("@/components/publish/FailureGroupDetailCard");
  return { default: mod.FailureGroupDetailCard };
});

const ExecutionHistoryCard = lazy(async () => {
  const mod = await import("@/components/publish/ExecutionHistoryCard");
  return { default: mod.ExecutionHistoryCard };
});

export interface PublishContentSectionProps {
  showCommandImportResultCard: boolean;
  commandImportResultCardProps: CommandImportResultCardProps | null;
  outputLogCardProps: OutputLogCardProps;
  failureGroupsCardProps: FailureGroupsCardProps;
  failureGroupDetailCardProps: FailureGroupDetailCardProps;
  executionHistoryCardProps: ExecutionHistoryCardProps;
  rightPanelView: "home" | "history";
}

export function PublishContentSection({
  showCommandImportResultCard,
  commandImportResultCardProps,
  outputLogCardProps,
  failureGroupsCardProps,
  failureGroupDetailCardProps,
  executionHistoryCardProps,
  rightPanelView,
}: PublishContentSectionProps) {
  const hasOutputLogCard =
    Boolean(outputLogCardProps.outputLog) ||
    outputLogCardProps.publishResult !== null ||
    outputLogCardProps.publishControls !== null;
  const hasFailureGroups = failureGroupsCardProps.failureGroups.length > 0;
  const hasFailureGroupDetail =
    failureGroupDetailCardProps.selectedFailureGroup !== null;
  const hasExecutionHistory =
    executionHistoryCardProps.scopedExecutionHistory.length > 0;

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
          {hasFailureGroups && (
            <div className="mx-auto w-full max-w-3xl">
              <Suspense fallback={null}>
                <FailureGroupsCard {...failureGroupsCardProps} />
              </Suspense>
            </div>
          )}
          {hasFailureGroupDetail && (
            <div className="mx-auto w-full max-w-3xl">
              <Suspense fallback={null}>
                <FailureGroupDetailCard {...failureGroupDetailCardProps} />
              </Suspense>
            </div>
          )}
        </>
      ) : (
        hasExecutionHistory && (
          <div className="mx-auto w-full max-w-3xl">
            <Suspense fallback={null}>
              <ExecutionHistoryCard {...executionHistoryCardProps} />
            </Suspense>
          </div>
        )
      )}
    </div>
  );
}
