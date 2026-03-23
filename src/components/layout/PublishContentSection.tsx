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
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      {showCommandImportResultCard && commandImportResultCardProps && (
        <CommandImportResultCard {...commandImportResultCardProps} />
      )}
      {rightPanelView === "home" ? (
        <OutputLogCard {...outputLogCardProps} />
      ) : (
        <ExecutionHistoryCard {...executionHistoryCardProps} />
      )}
      <FailureGroupsCard {...failureGroupsCardProps} />
      <FailureGroupDetailCard {...failureGroupDetailCardProps} />
    </div>
  );
}
