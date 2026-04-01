import { useMemo } from "react";

import {
  getEnvironmentCheckSnapshotResult,
  type EnvironmentCheckSnapshot,
} from "@/lib/environment";

export type EnvironmentStatus = "unknown" | "ready" | "warning" | "blocked";

export function useEnvironmentStatus(
  environmentLastCheck: EnvironmentCheckSnapshot | null,
  activeProviderId: string
): EnvironmentStatus {
  return useMemo(() => {
    const scopedResult = getEnvironmentCheckSnapshotResult(
      environmentLastCheck,
      [activeProviderId]
    );

    if (!scopedResult) {
      return "unknown";
    }

    if (
      scopedResult.providers.some((provider) => !provider.installed) ||
      scopedResult.issues.some((issue) => issue.severity === "critical")
    ) {
      return "blocked";
    }

    if (scopedResult.issues.some((issue) => issue.severity === "warning")) {
      return "warning";
    }

    return "ready";
  }, [activeProviderId, environmentLastCheck]);
}
