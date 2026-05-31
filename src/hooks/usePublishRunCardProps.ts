import { useMemo } from "react";
import type { PublishRunCardProps } from "@/components/publish/PublishRunCard";
import type { Repository, ProjectInfo } from "@/lib/store/types";

type TranslationMap = Record<string, string | undefined>;

interface UsePublishRunCardPropsParams {
  outputLog: string;
  publishResult: any;
  appT: TranslationMap;
  publishT: TranslationMap;
  configT: TranslationMap;
  isRefreshing: boolean;
  selectedRepo: Repository | null;
  activeProviderRequiresProjectBinding: boolean;
  projectInfo: ProjectInfo | null;
  publishPreviewCommand: string | null;
  isPublishing: boolean;
  isCancellingPublish: boolean;
  startPublish: () => void;
  cancelPublish: () => void;
}

export function usePublishRunCardProps(
  params: UsePublishRunCardPropsParams
): PublishRunCardProps {
  return useMemo(
    () => ({
      outputLog: params.outputLog,
      publishResult: params.publishResult,
      appT: params.appT,
      isRefreshing: params.isRefreshing,
      publishActions:
        params.selectedRepo &&
        (params.activeProviderRequiresProjectBinding
          ? Boolean(params.projectInfo)
          : true)
          ? {
              publishCommand: params.publishPreviewCommand || null,
              publishCommandLabel: params.publishT.command || "将执行的命令:",
              startLabel: params.configT.execute || "执行发布",
              publishingLabel: params.configT.publishing || "发布中...",
              cancelLabel: params.appT.cancelPublish || "取消发布",
              cancellingLabel: params.appT.cancelling || "取消中...",
              isPublishing: params.isPublishing,
              isCancellingPublish: params.isCancellingPublish,
              startDisabled: !params.selectedRepo,
              onStartPublish: params.startPublish,
              onCancelPublish: params.cancelPublish,
            }
          : null,
    }),
    [
      params.activeProviderRequiresProjectBinding,
      params.appT,
      params.cancelPublish,
      params.configT.execute,
      params.configT.publishing,
      params.isCancellingPublish,
      params.isRefreshing,
      params.isPublishing,
      params.outputLog,
      params.publishPreviewCommand,
      params.projectInfo,
      params.publishResult,
      params.publishT.command,
      params.selectedRepo,
      params.startPublish,
    ]
  );
}
