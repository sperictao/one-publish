import { CommandImportResultCard, type CommandImportResultCardProps } from "@/components/publish/CommandImportResultCard";
import {
  FailureGroupDetailCard,
  type FailureGroupDetailCardProps,
} from "@/components/publish/FailureGroupDetailCard";
import { FailureGroupsCard, type FailureGroupsCardProps } from "@/components/publish/FailureGroupsCard";
import { OutputLogCard, type OutputLogCardProps } from "@/components/publish/OutputLogCard";
import {
  ExecutionHistoryCard,
  type ExecutionHistoryCardProps,
} from "@/components/publish/ExecutionHistoryCard";

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
          <CommandImportResultCard {...commandImportResultCardProps} />
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
              <FailureGroupsCard {...failureGroupsCardProps} />
            </div>
          )}
          {hasFailureGroupDetail && (
            <div className="mx-auto w-full max-w-3xl">
              <FailureGroupDetailCard {...failureGroupDetailCardProps} />
            </div>
          )}
        </>
      ) : (
        hasExecutionHistory && (
          <div className="mx-auto w-full max-w-3xl">
            <ExecutionHistoryCard {...executionHistoryCardProps} />
          </div>
        )
      )}
    </div>
  );
}
