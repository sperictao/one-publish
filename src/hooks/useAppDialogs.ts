import { useCallback, useState } from "react";

import {
  scopeEnvironmentCheckSnapshot,
  normalizeEnvironmentProviderIds,
  type EnvironmentCheckSnapshot,
} from "@/lib/environment";

export function useAppDialogs(environmentProviderIds: string[]) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [commandImportOpen, setCommandImportOpen] = useState(false);
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [environmentDialogOpen, setEnvironmentDialogOpen] = useState(false);
  const [environmentDefaultProviderIds, setEnvironmentDefaultProviderIds] =
    useState<string[]>(() => normalizeEnvironmentProviderIds(environmentProviderIds));
  const [environmentInitialCheck, setEnvironmentInitialCheck] =
    useState<EnvironmentCheckSnapshot | null>(null);

  const handleOpenSettings = useCallback(() => {
    setSettingsOpen(true);
  }, []);

  const openEnvironmentDialog = useCallback(
    (
      initialCheck: EnvironmentCheckSnapshot | null = null,
      providerIds: string[] = environmentProviderIds
    ) => {
      const normalizedProviderIds = normalizeEnvironmentProviderIds(providerIds);
      setEnvironmentDefaultProviderIds(normalizedProviderIds);
      setEnvironmentInitialCheck(
        scopeEnvironmentCheckSnapshot(initialCheck, normalizedProviderIds)
      );
      setEnvironmentDialogOpen(true);
    },
    [environmentProviderIds]
  );

  const handleEnvironmentDialogOpenChange = useCallback((open: boolean) => {
    setEnvironmentDialogOpen(open);
    if (!open) {
      setEnvironmentInitialCheck(null);
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
    environmentInitialCheck,
    handleOpenSettings,
    openEnvironmentDialog,
    handleEnvironmentDialogOpenChange,
    handleConfigDialogOpenChange,
  };
}
