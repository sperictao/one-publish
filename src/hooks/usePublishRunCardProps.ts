import { useMemo } from "react";
import type { PublishRunCardProps } from "@/components/publish/PublishRunCard";
import type { Repository, ProjectInfo } from "@/lib/store/types";
import type {
  PreparedPublishRuntime,
  PublishRuntimeResult,
} from "@/generated/tauri-contracts";
type TranslationMap = Record<string, string | undefined>;

interface UsePublishRunCardPropsParams {
  outputLog: string;
  getOutputLogSnapshot: () => string;
  publishResult: any;
  appT: TranslationMap;
  publishT: TranslationMap;
  configT: TranslationMap;
  isRefreshing: boolean;
  selectedRepo: Repository | null;
  activeProviderRequiresProjectBinding: boolean;
  projectInfo: ProjectInfo | null;
  publishPreviewCommand: string | null;
  preparedRuntime: PreparedPublishRuntime | null;
  activeRuntime: PreparedPublishRuntime | null;
  runtimeResult: PublishRuntimeResult | null;
  runtimePreparationError: string | null;
  requiresPreparedRuntime: boolean;
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
      getOutputLogSnapshot: params.getOutputLogSnapshot,
      publishResult: params.publishResult,
      preparedRuntime: params.preparedRuntime,
      activeRuntime: params.activeRuntime,
      runtimeResult: params.runtimeResult,
      runtimePreparationError: params.runtimePreparationError,
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
              startDisabled:
                !params.selectedRepo ||
                (params.requiresPreparedRuntime &&
                  (!params.preparedRuntime ||
                    Boolean(params.preparedRuntime.blockedReason) ||
                    !params.preparedRuntime.runtimeToken)),
              onStartPublish: params.startPublish,
              onCancelPublish: params.cancelPublish,
            }
          : null,
    }),
    [
      params.activeProviderRequiresProjectBinding,
      params.activeRuntime,
      params.appT,
      params.cancelPublish,
      params.configT.execute,
      params.configT.publishing,
      params.getOutputLogSnapshot,
      params.isCancellingPublish,
      params.isRefreshing,
      params.isPublishing,
      params.outputLog,
      params.publishPreviewCommand,
      params.preparedRuntime,
      params.projectInfo,
      params.publishResult,
      params.requiresPreparedRuntime,
      params.runtimeResult,
      params.runtimePreparationError,
      params.publishT.command,
      params.selectedRepo,
      params.startPublish,
    ]
  );
}
