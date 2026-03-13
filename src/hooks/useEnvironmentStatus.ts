import { useMemo } from "react";

import type { EnvironmentCheckResult } from "@/lib/environment";

export type EnvironmentStatus = "unknown" | "ready" | "warning" | "blocked";

export function useEnvironmentStatus(
  environmentLastResult: EnvironmentCheckResult | null
): EnvironmentStatus {
  return useMemo(() => {
    if (!environmentLastResult) {
      return "unknown";
    }
    if (environmentLastResult.issues.some((issue) => issue.severity === "critical")) {
      return "blocked";
    }
    if (environmentLastResult.issues.some((issue) => issue.severity === "warning")) {
      return "warning";
    }
    return "ready";
  }, [environmentLastResult]);
}
