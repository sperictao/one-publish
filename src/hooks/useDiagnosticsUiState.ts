import { useCallback, useState } from "react";

import type { EnvironmentCheckResult } from "@/lib/environment";

export function useDiagnosticsUiState() {
  const [environmentLastResult, setEnvironmentLastResult] =
    useState<EnvironmentCheckResult | null>(null);
  const [recentBundleExports, setRecentBundleExports] = useState<string[]>([]);
  const [recentHistoryExports, setRecentHistoryExports] = useState<string[]>([]);

  const trackBundleExport = useCallback((outputPath: string) => {
    setRecentBundleExports((prev) =>
      [outputPath, ...prev.filter((item) => item !== outputPath)].slice(0, 20)
    );
  }, []);

  const trackHistoryExport = useCallback((outputPath: string) => {
    setRecentHistoryExports((prev) =>
      [outputPath, ...prev.filter((item) => item !== outputPath)].slice(0, 20)
    );
  }, []);

  return {
    environmentLastResult,
    setEnvironmentLastResult,
    recentBundleExports,
    recentHistoryExports,
    trackBundleExport,
    trackHistoryExport,
  };
}
