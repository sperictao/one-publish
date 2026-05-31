// useAppState - 应用状态管理 Hook（Zustand store wrapper）
// 提供向后兼容的接口，底层使用 useAppStore()

import { useEffect, useMemo } from "react";
import { useAppStore } from "@/stores/appStore";
import {
  defaultPublishConfigStore,
  defaultRepoPublishConfig,
} from "@/lib/store/types";

export function useAppState() {
  const store = useAppStore();
  const currentPublishConfig = useMemo(() => {
    const repo =
      store.repositories.find((item) => item.id === store.selectedRepoId) ?? null;

    return (
      repo?.publishConfig ?? {
        ...defaultRepoPublishConfig,
        customConfig: { ...defaultPublishConfigStore },
      }
    );
  }, [store.repositories, store.selectedRepoId]);

  // 初始化加载（仅一次，store 内部保证幂等）
  useEffect(() => {
    if (store.isLoading) {
      void store.loadState();
    }
  }, [store.isLoading, store.loadState]);

  return {
    // 状态
    state: store,
    isLoading: store.isLoading,
    error: store.error,

    // 仓库操作
    repositories: store.repositories,
    selectedRepoId: store.selectedRepoId,
    recentRepoIds: store.recentRepoIds,
    recentConfigKeysByRepo: store.recentConfigKeysByRepo,
    addRepository: store.addRepository,
    removeRepository: store.removeRepository,
    updateRepository: store.updateRepository,
    reorderRepositories: store.reorderRepositories,
    selectRepository: store.selectRepository,
    pushRecentPublishConfig: store.pushRecentPublishConfig,
    removeRecentPublishConfig: store.removeRecentPublishConfig,
    reorderRecentPublishConfigs: store.reorderRecentPublishConfigs,
    replaceRecentPublishConfigKey: store.replaceRecentPublishConfigKey,

    // UI 状态
    leftPanelWidth: store.leftPanelWidth,
    middlePanelWidth: store.middlePanelWidth,
    panelWidthsCustomized: store.panelWidthsCustomized,
    setLeftPanelWidth: store.setLeftPanelWidth,
    setMiddlePanelWidth: store.setMiddlePanelWidth,

    // 发布配置（从当前仓库派生）
    selectedPreset: currentPublishConfig.selectedPreset,
    isCustomMode: currentPublishConfig.isCustomMode,
    customConfig: currentPublishConfig.customConfig,
    setSelectedPreset: store.setSelectedPreset,
    setIsCustomMode: store.setIsCustomMode,
    setCustomConfig: store.setCustomConfig,

    // 偏好设置
    language: store.language,
    minimizeToTrayOnClose: store.minimizeToTrayOnClose,
    defaultOutputDir: store.defaultOutputDir,
    theme: store.theme,
    executionHistoryLimit: store.executionHistoryLimit,
    environmentProviderIds: store.environmentProviderIds,
    startupNotice: store.startupNotice,
    setLanguage: store.setLanguage,
    setMinimizeToTrayOnClose: store.setMinimizeToTrayOnClose,
    setDefaultOutputDir: store.setDefaultOutputDir,
    setTheme: store.setTheme,
    setExecutionHistoryLimit: store.setExecutionHistoryLimit,
    setEnvironmentProviderIds: store.setEnvironmentProviderIds,
  };
}
