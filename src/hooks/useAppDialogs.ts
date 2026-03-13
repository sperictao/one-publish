import { useCallback, useState } from "react";

import type { EnvironmentCheckResult } from "@/lib/environment";

export function useAppDialogs(activeProviderId: string) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [commandImportOpen, setCommandImportOpen] = useState(false);
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [environmentDialogOpen, setEnvironmentDialogOpen] = useState(false);
  const [environmentDefaultProviderIds, setEnvironmentDefaultProviderIds] =
    useState<string[]>(["dotnet"]);
  const [environmentInitialResult, setEnvironmentInitialResult] =
    useState<EnvironmentCheckResult | null>(null);

  const handleOpenSettings = useCallback(() => {
    setSettingsOpen(true);
  }, []);

  const openEnvironmentDialog = useCallback(
    (
      initialResult: EnvironmentCheckResult | null = null,
      providerIds: string[] = [activeProviderId]
    ) => {
      setEnvironmentDefaultProviderIds(providerIds);
      setEnvironmentInitialResult(initialResult);
      setEnvironmentDialogOpen(true);
    },
    [activeProviderId]
  );

  const handleEnvironmentDialogOpenChange = useCallback((open: boolean) => {
    setEnvironmentDialogOpen(open);
    if (!open) {
      setEnvironmentInitialResult(null);
    }
  }, []);

  const handleConfigDialogOpenChange = useCallback(
    (open: boolean, onClose?: () => void) => {
      setConfigDialogOpen(open);
      if (!open) {
        onClose?.();
      }
    },
    []
  );

  return {
    settingsOpen,
    setSettingsOpen,
    shortcutsOpen,
    setShortcutsOpen,
    commandImportOpen,
    setCommandImportOpen,
    configDialogOpen,
    setConfigDialogOpen,
    environmentDialogOpen,
    setEnvironmentDialogOpen,
    environmentDefaultProviderIds,
    environmentInitialResult,
    handleOpenSettings,
    openEnvironmentDialog,
    handleEnvironmentDialogOpenChange,
    handleConfigDialogOpenChange,
  };
}
