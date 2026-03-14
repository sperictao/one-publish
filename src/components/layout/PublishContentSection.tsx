import { CommandImportResultCard, type CommandImportResultCardProps } from "@/components/publish/CommandImportResultCard";
import { DotnetPublishCard, type DotnetPublishCardProps } from "@/components/publish/DotnetPublishCard";
import {
  FailureGroupDetailCard,
  type FailureGroupDetailCardProps,
} from "@/components/publish/FailureGroupDetailCard";
import { FailureGroupsCard, type FailureGroupsCardProps } from "@/components/publish/FailureGroupsCard";
import {
  GenericProviderPublishCard,
  type GenericProviderPublishCardProps,
} from "@/components/publish/GenericProviderPublishCard";
import { OutputLogCard, type OutputLogCardProps } from "@/components/publish/OutputLogCard";
import {
  ExecutionHistoryCard,
  type ExecutionHistoryCardProps,
} from "@/components/publish/ExecutionHistoryCard";

export interface PublishContentSectionProps {
  showDotnetPublishCard: boolean;
  showGenericProviderPublishCard: boolean;
  showCommandImportResultCard: boolean;
  dotnetPublishCardProps: DotnetPublishCardProps;
  genericProviderPublishCardProps: GenericProviderPublishCardProps;
  commandImportResultCardProps: CommandImportResultCardProps | null;
  outputLogCardProps: OutputLogCardProps;
  failureGroupsCardProps: FailureGroupsCardProps;
  failureGroupDetailCardProps: FailureGroupDetailCardProps;
  executionHistoryCardProps: ExecutionHistoryCardProps;
}

export function PublishContentSection({
  showDotnetPublishCard,
  showGenericProviderPublishCard,
  showCommandImportResultCard,
  dotnetPublishCardProps,
  genericProviderPublishCardProps,
  commandImportResultCardProps,
  outputLogCardProps,
  failureGroupsCardProps,
  failureGroupDetailCardProps,
  executionHistoryCardProps,
}: PublishContentSectionProps) {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      {showDotnetPublishCard && <DotnetPublishCard {...dotnetPublishCardProps} />}
      {showGenericProviderPublishCard && (
        <GenericProviderPublishCard {...genericProviderPublishCardProps} />
      )}
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
