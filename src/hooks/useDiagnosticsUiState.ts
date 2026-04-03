import { useCallback, useState } from "react";

import type { EnvironmentCheckSnapshot } from "@/lib/environment";

export function useDiagnosticsUiState() {
  const [environmentLastCheck, setEnvironmentLastCheck] =
    useState<EnvironmentCheckSnapshot | null>(null);
  const [recentHistoryExports, setRecentHistoryExports] = useState<string[]>([]);

  const trackHistoryExport = useCallback((outputPath: string) => {
    setRecentHistoryExports((prev) =>
      [outputPath, ...prev.filter((item) => item !== outputPath)].slice(0, 20)
    );
  }, []);

  return {
    environmentLastCheck,
    setEnvironmentLastCheck,
    recentHistoryExports,
    trackHistoryExport,
  };
}
