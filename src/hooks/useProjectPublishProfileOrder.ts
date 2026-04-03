import { useCallback, useMemo, useState } from "react";
import { applyStoredOrder } from "@/lib/listOrdering";

const PROJECT_PROFILE_ORDER_KEY = "one-publish:projectPublishProfileOrder";

function parseStoredOrderMap(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(PROJECT_PROFILE_ORDER_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    return Object.entries(parsed as Record<string, unknown>).reduce<
      Record<string, string[]>
    >((acc, [scopeKey, value]) => {
      if (!Array.isArray(value)) {
        return acc;
      }

      const normalized = value.filter(
        (item): item is string => typeof item === "string"
      );
      if (normalized.length > 0) {
        acc[scopeKey] = normalized;
      }

      return acc;
    }, {});
  } catch {
    return {};
  }
}

function persistStoredOrderMap(orderMap: Record<string, string[]>) {
  try {
    localStorage.setItem(PROJECT_PROFILE_ORDER_KEY, JSON.stringify(orderMap));
  } catch {
    // noop
  }
}

function buildProjectProfileScopeKey(
  repoId: string | null,
  projectFilePath?: string
): string | null {
  const normalizedRepoId = repoId?.trim() || "";
  const normalizedProjectFilePath = projectFilePath?.trim() || "";

  if (!normalizedRepoId && !normalizedProjectFilePath) {
    return null;
  }

  return `${normalizedRepoId}::${normalizedProjectFilePath}`;
}

export function useProjectPublishProfileOrder(params: {
  repoId: string | null;
  projectFilePath?: string;
  projectPublishProfiles: string[];
}) {
  const { repoId, projectFilePath, projectPublishProfiles } = params;
  const [storedOrderMap, setStoredOrderMap] = useState<Record<string, string[]>>(
    () => parseStoredOrderMap()
  );

  const scopeKey = useMemo(
    () => buildProjectProfileScopeKey(repoId, projectFilePath),
    [projectFilePath, repoId]
  );

  const orderedProjectPublishProfiles = useMemo(() => {
    if (!scopeKey) {
      return projectPublishProfiles;
    }

    return applyStoredOrder(projectPublishProfiles, storedOrderMap[scopeKey] ?? []);
  }, [projectPublishProfiles, scopeKey, storedOrderMap]);

  const reorderProjectPublishProfiles = useCallback(
    (orderedNames: string[]) => {
      if (!scopeKey) {
        return;
      }

      const normalizedOrder = applyStoredOrder(projectPublishProfiles, orderedNames);

      setStoredOrderMap((prev) => {
        const next = {
          ...prev,
          [scopeKey]: normalizedOrder,
        };
        persistStoredOrderMap(next);
        return next;
      });
    },
    [projectPublishProfiles, scopeKey]
  );

  return {
    orderedProjectPublishProfiles,
    reorderProjectPublishProfiles,
  };
}
