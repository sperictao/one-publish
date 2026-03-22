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
}

export function PublishContentSection({
  showCommandImportResultCard,
  commandImportResultCardProps,
  outputLogCardProps,
  failureGroupsCardProps,
  failureGroupDetailCardProps,
  executionHistoryCardProps,
}: PublishContentSectionProps) {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      {showCommandImportResultCard && commandImportResultCardProps && (
        <CommandImportResultCard {...commandImportResultCardProps} />
      )}
      <OutputLogCard {...outputLogCardProps} />
      <FailureGroupsCard {...failureGroupsCardProps} />
      <FailureGroupDetailCard {...failureGroupDetailCardProps} />
      <ExecutionHistoryCard {...executionHistoryCardProps} />
    </div>
  );
}
