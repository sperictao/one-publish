import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import {
  loadDailyTriagePreset,
  loadHistoryFilterPresets,
  saveDailyTriagePreset,
  saveHistoryFilterPresets,
  type DailyTriagePreset,
  type HistoryFilterPreset,
  type HistoryFilterStatus,
  type HistoryFilterWindow,
} from "@/lib/historyFilterPresets";

interface TranslationMap {
  [key: string]: string | undefined;
}

interface UseHistoryPresetsParams {
  historyT: TranslationMap;
  historyFilterProvider: string;
  historyFilterStatus: HistoryFilterStatus;
  historyFilterWindow: HistoryFilterWindow;
  historyFilterKeyword: string;
}

export function useHistoryPresets({
  historyT,
  historyFilterProvider,
  historyFilterStatus,
  historyFilterWindow,
  historyFilterKeyword,
}: UseHistoryPresetsParams) {
  const [historyFilterPresets, setHistoryFilterPresets] = useState<
    HistoryFilterPreset[]
  >(() => loadHistoryFilterPresets());
  const [dailyTriagePreset, setDailyTriagePreset] = useState<DailyTriagePreset>(
    () => loadDailyTriagePreset()
  );
  const [selectedHistoryPresetId, setSelectedHistoryPresetId] = useState("none");

  useEffect(() => {
    saveHistoryFilterPresets(historyFilterPresets);
  }, [historyFilterPresets]);

  useEffect(() => {
    saveDailyTriagePreset(dailyTriagePreset);
  }, [dailyTriagePreset]);

  useEffect(() => {
    if (
      selectedHistoryPresetId !== "none" &&
      !historyFilterPresets.some((preset) => preset.id === selectedHistoryPresetId)
    ) {
      setSelectedHistoryPresetId("none");
    }
  }, [historyFilterPresets, selectedHistoryPresetId]);

  const applyHistoryPreset = useCallback(
    (
      presetId: string,
      handlers: {
        setHistoryFilterProvider: (value: string) => void;
        setHistoryFilterStatus: (value: HistoryFilterStatus) => void;
        setHistoryFilterWindow: (value: HistoryFilterWindow) => void;
        setHistoryFilterKeyword: (value: string) => void;
      }
    ) => {
      if (presetId === "none") {
        setSelectedHistoryPresetId("none");
        return;
      }

      const preset = historyFilterPresets.find((item) => item.id === presetId);
      if (!preset) {
        toast.error(historyT.presetNotFound || "未找到筛选预设");
        return;
      }

      handlers.setHistoryFilterProvider(preset.provider);
      handlers.setHistoryFilterStatus(preset.status);
      handlers.setHistoryFilterWindow(preset.window);
      handlers.setHistoryFilterKeyword(preset.keyword);
      setSelectedHistoryPresetId(preset.id);
    },
    [historyFilterPresets, historyT.presetNotFound]
  );

  const saveCurrentHistoryPreset = useCallback(() => {
    const defaultName =
      (historyT.presetNamePrefix || "筛选预设") +
      ` ${historyFilterPresets.length + 1}`;
    const input =
      typeof window !== "undefined"
        ? window.prompt(historyT.promptPresetName || "输入筛选预设名称", defaultName)
        : defaultName;
    if (!input) {
      return;
    }

    const name = input.trim();
    if (!name) {
      toast.error(historyT.presetNameRequired || "筛选预设名称不能为空");
      return;
    }

    const existingPreset = historyFilterPresets.find((item) => item.name === name);
    const presetId =
      existingPreset?.id || `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

    const preset: HistoryFilterPreset = {
      id: presetId,
      name,
      provider: historyFilterProvider,
      status: historyFilterStatus,
      window: historyFilterWindow,
      keyword: historyFilterKeyword,
    };

    setHistoryFilterPresets((prev) => {
      const existingIndex = prev.findIndex((item) => item.id === presetId);
      if (existingIndex >= 0) {
        const next = [...prev];
        next[existingIndex] = preset;
        return next;
      }

      return [preset, ...prev].slice(0, 20);
    });

    setSelectedHistoryPresetId(presetId);
    toast.success(historyT.presetSaved || "筛选预设已保存", {
      description: name,
    });
  }, [
    historyFilterKeyword,
    historyFilterPresets,
    historyFilterProvider,
    historyFilterStatus,
    historyFilterWindow,
    historyT.presetNamePrefix,
    historyT.promptPresetName,
    historyT.presetNameRequired,
    historyT.presetSaved,
  ]);

  const deleteSelectedHistoryPreset = useCallback(() => {
    if (selectedHistoryPresetId === "none") {
      toast.error(historyT.selectPresetToDelete || "请先选择要删除的筛选预设");
      return;
    }

    const current = historyFilterPresets.find(
      (preset) => preset.id === selectedHistoryPresetId
    );

    setHistoryFilterPresets((prev) =>
      prev.filter((preset) => preset.id !== selectedHistoryPresetId)
    );
    setSelectedHistoryPresetId("none");

    toast.success(historyT.presetDeleted || "筛选预设已删除", {
      description: current?.name || "",
    });
  }, [
    historyFilterPresets,
    historyT.presetDeleted,
    historyT.selectPresetToDelete,
    selectedHistoryPresetId,
  ]);

  return {
    historyFilterPresets,
    dailyTriagePreset,
    setDailyTriagePreset,
    selectedHistoryPresetId,
    setSelectedHistoryPresetId,
    applyHistoryPreset,
    saveCurrentHistoryPreset,
    deleteSelectedHistoryPreset,
  };
}
