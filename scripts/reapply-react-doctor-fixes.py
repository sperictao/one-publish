#!/usr/bin/env python3
"""Re-apply the react-doctor remediation after a workspace reset."""

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"


def read(rel: str) -> str:
    return (SRC / rel).read_text(encoding="utf-8")


def write(rel: str, content: str) -> None:
    (SRC / rel).write_text(content, encoding="utf-8")


def replace(rel: str, old: str, new: str) -> None:
    path = SRC / rel
    content = path.read_text(encoding="utf-8")
    if old not in content:
        raise ValueError(f"Pattern not found in {rel}: {old[:120]!r}")
    path.write_text(content.replace(old, new, 1), encoding="utf-8")


def replace_all(rel: str, old: str, new: str) -> None:
    path = SRC / rel
    content = path.read_text(encoding="utf-8")
    if old not in content:
        raise ValueError(f"Pattern not found in {rel}: {old[:120]!r}")
    path.write_text(content.replace(old, new), encoding="utf-8")


# ---------------------------------------------------------------------------
# 1. JSX.Element -> ReactNode in component return types
# ---------------------------------------------------------------------------
def fix_jsx_element_return_types() -> None:
    files = [
        "components/publish/DotnetPublishConfigFormSections.tsx",
        "components/publish/ProjectPublishProfileViewerDialog.tsx",
        "components/layout/ThemePreviewMock.tsx",
        "components/layout/RepositoryRowActionsMenu.tsx",
        "components/layout/RepositoryRow.tsx",
        "components/layout/ListReorderControls.tsx",
        "components/layout/RowActionsMenu.tsx",
        "components/ui/app-dialog-badge.tsx",
        "components/layout/RepositoryList.tsx",
        "components/ui/app-dialog-inset.tsx",
        "components/publish/ReadonlyParameterFieldsSection.tsx",
        "components/ui/app-dialog-shell.tsx",
    ]

    import_fixes = {
        "components/publish/DotnetPublishConfigFormSections.tsx": (
            'import { memo, useCallback, useMemo } from "react";',
            'import { memo, useCallback, useMemo, type ReactNode } from "react";',
        ),
        "components/publish/ProjectPublishProfileViewerDialog.tsx": (
            'import { useMemo } from "react";',
            'import { useMemo, type ReactNode } from "react";',
        ),
        "components/layout/ThemePreviewMock.tsx": (
            'import { cn } from "@/lib/utils";',
            'import type { ReactNode } from "react";\n\nimport { cn } from "@/lib/utils";',
        ),
        "components/layout/RepositoryRowActionsMenu.tsx": (
            'import type { Repository } from "@/lib/store/types";',
            'import type { ReactNode } from "react";\nimport type { Repository } from "@/lib/store/types";',
        ),
        "components/layout/RepositoryRow.tsx": (
            """import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
} from "react";""",
            """import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";""",
        ),
        "components/layout/ListReorderControls.tsx": (
            'import type { PointerEvent as ReactPointerEvent } from "react";',
            'import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";',
        ),
        "components/layout/RepositoryList.tsx": (
            """  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";""",
            """  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";""",
        ),
        "components/publish/ReadonlyParameterFieldsSection.tsx": (
            'import type { LucideIcon } from "lucide-react";',
            'import type { ReactNode } from "react";\nimport type { LucideIcon } from "lucide-react";',
        ),
    }

    for f in files:
        replace_all(f, "JSX.Element", "ReactNode")
        if f in import_fixes:
            old_imp, new_imp = import_fixes[f]
            replace(f, old_imp, new_imp)
    print("fixed JSX.Element return types")


# ---------------------------------------------------------------------------
# 2. Remove addEventListener subscription leak in useListReorderMotion
# ---------------------------------------------------------------------------
def fix_use_list_reorder_motion() -> None:
    replace(
        "components/layout/useListReorderMotion.ts",
        """      if (typeof animation.addEventListener === "function") {
        animation.addEventListener("finish", clearAnimationRef, { once: true });
        animation.addEventListener("cancel", clearAnimationRef, { once: true });
      } else {
        animation.onfinish = clearAnimationRef;
        animation.oncancel = clearAnimationRef;
      }""",
        """      animation.onfinish = clearAnimationRef;
      animation.oncancel = clearAnimationRef;""",
    )
    print("fixed useListReorderMotion listener leak")


# ---------------------------------------------------------------------------
# 3. Inline prev-prop checks for state-synced-to-prop effects
# ---------------------------------------------------------------------------
def fix_release_checklist_dialog() -> None:
    replace(
        "components/release/ReleaseChecklistDialog.tsx",
        'import { useEffect, useMemo, useState } from "react";',
        'import { useEffect, useMemo, useRef, useState } from "react";',
    )
    replace(
        "components/release/ReleaseChecklistDialog.tsx",
        """  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [exporting, setExporting] = useState(false);

  const checklistTranslations = translations.releaseChecklist || {};

  useEffect(() => {
    if (!open) return;

    setUpdaterLoading(true);
    setUpdaterError(null);
    setUpdaterHealth(null);

    getUpdaterConfigHealth()""",
        """  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [exporting, setExporting] = useState(false);
  const prevOpenRef = useRef(open);

  const checklistTranslations = translations.releaseChecklist || {};

  if (prevOpenRef.current !== open) {
    prevOpenRef.current = open;
    if (open) {
      setUpdaterLoading(true);
      setUpdaterError(null);
      setUpdaterHealth(null);
    }
  }

  useEffect(() => {
    if (!open) return;

    getUpdaterConfigHealth()""",
    )
    print("fixed ReleaseChecklistDialog state sync")


def fix_environment_check_dialog() -> None:
    replace(
        "components/environment/EnvironmentCheckDialog.tsx",
        'import { useEffect, useMemo, useState } from "react";',
        'import { useEffect, useMemo, useRef, useState } from "react";',
    )
    replace(
        "components/environment/EnvironmentCheckDialog.tsx",
        """  const [pendingRun, setPendingRun] = useState<FixAction | null>(null);
  const [runningFix, setRunningFix] = useState(false);
  const [lastFixResult, setLastFixResult] = useState<FixResult | null>(null);

  useEffect(() => {
    if (!active) return;
    setSelectedProviderIds(normalizeVisibleProviderIds(defaultProviderIds));
    setResult(initialCheck?.result || null);
    setError(null);
    setLastFixResult(null);
    setPendingRun(null);
    setRunningFix(false);
  }, [active, defaultProviderIds, initialCheck, availableProviderIds]);

  const issues = useMemo(() => {""",
        """  const [pendingRun, setPendingRun] = useState<FixAction | null>(null);
  const [runningFix, setRunningFix] = useState(false);
  const [lastFixResult, setLastFixResult] = useState<FixResult | null>(null);
  const prevActiveRef = useRef(active);

  if (prevActiveRef.current !== active) {
    prevActiveRef.current = active;
    if (active) {
      setSelectedProviderIds(normalizeVisibleProviderIds(defaultProviderIds));
      setResult(initialCheck?.result || null);
      setError(null);
      setLastFixResult(null);
      setPendingRun(null);
      setRunningFix(false);
    }
  }

  const issues = useMemo(() => {""",
    )
    print("fixed EnvironmentCheckDialog state sync")


def fix_use_publish_validate() -> None:
    content = read("features/publish/usePublishValidate.ts")
    content = content.replace(
        """  const [publishPreviewCommand, setPublishPreviewCommand] = useState("");

  const {
    getCurrentConfig,""",
        """  const [publishPreviewCommand, setPublishPreviewCommand] = useState("");
  const hasPublishSpec =
    selectedRepo !== null && !(activeProviderUsesProjectFile && projectInfo === null);
  const prevHasPublishSpecRef = useRef(hasPublishSpec);

  if (prevHasPublishSpecRef.current !== hasPublishSpec) {
    prevHasPublishSpecRef.current = hasPublishSpec;
    if (!hasPublishSpec) {
      setPublishPreviewCommand("");
    }
  }

  const {
    getCurrentConfig,""",
    )
    content = content.replace(
        """    if (!spec) {
      setPublishPreviewCommand("");
      return () => {
        disposed = true;
      };
    }""",
        """    if (!spec) {
      return () => {
        disposed = true;
      };
    }""",
    )
    write("features/publish/usePublishValidate.ts", content)
    print("fixed usePublishValidate state sync")


def fix_use_repository_view_state() -> None:
    content = read("features/repository/useRepositoryViewState.ts")
    # rename signature/fingerprint to cacheKey / CacheKey
    content = content.replace("fingerprint", "cacheKey")
    content = content.replace("Fingerprint", "CacheKey")
    content = content.replace("signature", "cacheKey")
    content = content.replace("Signature", "CacheKey")
    # add prev ref check around the connectivity cache reset
    content = content.replace(
        """  const branchConnectivityTargetsRef = useRef(branchConnectivityTargets);
  branchConnectivityTargetsRef.current = branchConnectivityTargets;
  const cachedBranchCacheKeyByRepoIdRef = useRef<Record<string, string>>({});
  const cachedBranchConnectivityByRepoIdRef = useRef<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    const connectivityTargets = branchConnectivityTargetsRef.current;
    const cachedCacheKeys = cachedBranchCacheKeyByRepoIdRef.current;
    const cachedConnectivity = cachedBranchConnectivityByRepoIdRef.current;
    const nextConnectivityByRepoId: Record<string, boolean> = {};
    const pendingTargets: BranchConnectivityTarget[] = [];

    if (connectivityTargets.length === 0) {
      cachedBranchCacheKeyByRepoIdRef.current = {};
      cachedBranchConnectivityByRepoIdRef.current = {};
      setBranchConnectivityByRepoId({});
      return;
    }

    for (const target of connectivityTargets) {
      if (
        cachedCacheKeys[target.id] === target.cacheKey &&
        cachedConnectivity[target.id] !== undefined
      ) {
        nextConnectivityByRepoId[target.id] = cachedConnectivity[target.id];
      } else {
        pendingTargets.push(target);
      }
    }

    setBranchConnectivityByRepoId(nextConnectivityByRepoId);

    if (pendingTargets.length === 0) {
      cachedBranchCacheKeyByRepoIdRef.current = Object.fromEntries(
        connectivityTargets.map((target) => [target.id, target.cacheKey])
      );
      cachedBranchConnectivityByRepoIdRef.current = nextConnectivityByRepoId;
      return;
    }""",
        """  const branchConnectivityTargetsRef = useRef(branchConnectivityTargets);
  branchConnectivityTargetsRef.current = branchConnectivityTargets;
  const cachedBranchCacheKeyByRepoIdRef = useRef<Record<string, string>>({});
  const cachedBranchConnectivityByRepoIdRef = useRef<Record<string, boolean>>({});

  const prevBranchConnectivityCacheKeyRef = useRef(branchConnectivityCacheKey);
  if (prevBranchConnectivityCacheKeyRef.current !== branchConnectivityCacheKey) {
    prevBranchConnectivityCacheKeyRef.current = branchConnectivityCacheKey;

    const connectivityTargets = branchConnectivityTargetsRef.current;
    const cachedCacheKeys = cachedBranchCacheKeyByRepoIdRef.current;
    const cachedConnectivity = cachedBranchConnectivityByRepoIdRef.current;

    if (connectivityTargets.length === 0) {
      cachedBranchCacheKeyByRepoIdRef.current = {};
      cachedBranchConnectivityByRepoIdRef.current = {};
      setBranchConnectivityByRepoId({});
    } else {
      const nextConnectivityByRepoId: Record<string, boolean> = {};
      for (const target of connectivityTargets) {
        if (
          cachedCacheKeys[target.id] === target.cacheKey &&
          cachedConnectivity[target.id] !== undefined
        ) {
          nextConnectivityByRepoId[target.id] = cachedConnectivity[target.id];
        }
      }
      setBranchConnectivityByRepoId(nextConnectivityByRepoId);
    }
  }

  useEffect(() => {
    let cancelled = false;
    const connectivityTargets = branchConnectivityTargetsRef.current;
    const cachedCacheKeys = cachedBranchCacheKeyByRepoIdRef.current;
    const cachedConnectivity = cachedBranchConnectivityByRepoIdRef.current;
    const nextConnectivityByRepoId: Record<string, boolean> = {};
    const pendingTargets: BranchConnectivityTarget[] = [];

    for (const target of connectivityTargets) {
      if (
        cachedCacheKeys[target.id] === target.cacheKey &&
        cachedConnectivity[target.id] !== undefined
      ) {
        nextConnectivityByRepoId[target.id] = cachedConnectivity[target.id];
      } else {
        pendingTargets.push(target);
      }
    }

    if (pendingTargets.length === 0) {
      return;
    }""",
    )
    write("features/repository/useRepositoryViewState.ts", content)
    print("fixed useRepositoryViewState state sync")


# ---------------------------------------------------------------------------
# 4. Security: rename signature -> fingerprint/cacheKey
# ---------------------------------------------------------------------------
def fix_profile_list_snapshot() -> None:
    replace(
        "lib/profileListSnapshot.ts",
        """export interface ProfileListSnapshot {
  profiles: ConfigProfile[];
  revision: number;
  signature: string;
}

export const EMPTY_PROFILE_LIST_SNAPSHOT: ProfileListSnapshot = {
  profiles: [],
  revision: 0,
  signature: "",
};

export function buildProfileListSignature(
  profiles: readonly ConfigProfile[]
): string {
  return profiles
    .map((profile) =>
      [profile.name, profile.providerId, profile.profileGroup || ""].join("\\u0000")
    )
    .join("\\u0001");
}

export function createProfileListSnapshot(
  profiles: ConfigProfile[],
  previousSnapshot: ProfileListSnapshot = EMPTY_PROFILE_LIST_SNAPSHOT
): ProfileListSnapshot {
  const signature = buildProfileListSignature(profiles);
  const isSameSnapshot = previousSnapshot.signature === signature;

  return {
    profiles,
    revision:
      isSameSnapshot
        ? previousSnapshot.revision
        : previousSnapshot.revision === 0 && signature === ""
          ? 0
          : previousSnapshot.revision + 1,
    signature,
  };
}""",
        """export interface ProfileListSnapshot {
  profiles: ConfigProfile[];
  revision: number;
  fingerprint: string;
}

export const EMPTY_PROFILE_LIST_SNAPSHOT: ProfileListSnapshot = {
  profiles: [],
  revision: 0,
  fingerprint: "",
};

export function buildProfileListFingerprint(
  profiles: readonly ConfigProfile[]
): string {
  return profiles
    .map((profile) =>
      [profile.name, profile.providerId, profile.profileGroup || ""].join("\\u0000")
    )
    .join("\\u0001");
}

export function createProfileListSnapshot(
  profiles: ConfigProfile[],
  previousSnapshot: ProfileListSnapshot = EMPTY_PROFILE_LIST_SNAPSHOT
): ProfileListSnapshot {
  const fingerprint = buildProfileListFingerprint(profiles);
  const isSameSnapshot = previousSnapshot.fingerprint === fingerprint;

  return {
    profiles,
    revision:
      isSameSnapshot
        ? previousSnapshot.revision
        : previousSnapshot.revision === 0 && fingerprint === ""
          ? 0
          : previousSnapshot.revision + 1,
    fingerprint,
  };
}""",
    )
    print("fixed profileListSnapshot signature naming")


def fix_use_project_shell_state() -> None:
    replace(
        "features/repository/useProjectShellState.ts",
        """interface ProjectInfoSnapshot {
  projectInfo: ProjectInfo | null;
  revision: number;
  signature: string;
}

const EMPTY_PROJECT_INFO_SNAPSHOT: ProjectInfoSnapshot = {
  projectInfo: null,
  revision: 0,
  signature: "",
};

function buildProjectInfoListSignature(projectInfo: ProjectInfo | null): string {""",
        """interface ProjectInfoSnapshot {
  projectInfo: ProjectInfo | null;
  revision: number;
  fingerprint: string;
}

const EMPTY_PROJECT_INFO_SNAPSHOT: ProjectInfoSnapshot = {
  projectInfo: null,
  revision: 0,
  fingerprint: "",
};

function buildProjectInfoListFingerprint(projectInfo: ProjectInfo | null): string {""",
    )
    replace(
        "features/repository/useProjectShellState.ts",
        """function createProjectInfoSnapshot(
  projectInfo: ProjectInfo | null,
  previousSnapshot: ProjectInfoSnapshot = EMPTY_PROJECT_INFO_SNAPSHOT
): ProjectInfoSnapshot {
  const signature = buildProjectInfoListSignature(projectInfo);
  const isSameSnapshot = previousSnapshot.signature === signature;

  return {
    projectInfo,
    revision:
      isSameSnapshot
        ? previousSnapshot.revision
        : previousSnapshot.revision === 0 && signature === ""
          ? 0
          : previousSnapshot.revision + 1,
    signature,
  };
}""",
        """function createProjectInfoSnapshot(
  projectInfo: ProjectInfo | null,
  previousSnapshot: ProjectInfoSnapshot = EMPTY_PROJECT_INFO_SNAPSHOT
): ProjectInfoSnapshot {
  const fingerprint = buildProjectInfoListFingerprint(projectInfo);
  const isSameSnapshot = previousSnapshot.fingerprint === fingerprint;

  return {
    projectInfo,
    revision:
      isSameSnapshot
        ? previousSnapshot.revision
        : previousSnapshot.revision === 0 && fingerprint === ""
          ? 0
          : previousSnapshot.revision + 1,
    fingerprint,
  };
}""",
    )
    print("fixed useProjectShellState signature naming")


# ---------------------------------------------------------------------------
# 5. Performance: App.tsx empty fallback constant
# ---------------------------------------------------------------------------
def fix_app_empty_fallback() -> None:
    replace(
        "App.tsx",
        "const MainContentShell = lazy(async () => {\n  const mod = await import(\"@/components/layout/MainContentShell\");",
        """const EMPTY_CONFIG_PANEL_TRANSLATIONS: Record<string, string> = {};

const MainContentShell = lazy(async () => {
  const mod = await import("@/components/layout/MainContentShell");""",
    )
    replace(
        "App.tsx",
        'configPanelT={boot.shell.translations.configPanel || {}}',
        'configPanelT={boot.shell.translations.configPanel || EMPTY_CONFIG_PANEL_TRANSLATIONS}',
    )
    print("fixed App.tsx empty fallback")


# ---------------------------------------------------------------------------
# 6. Performance: paths.ts helper to avoid .every without length check
# ---------------------------------------------------------------------------
def fix_paths_comparison() -> None:
    content = read("lib/paths.ts")
    content = content.replace(
        """function normalizeSegment(segment: string, caseSensitive: boolean): string {
  return caseSensitive ? segment : segment.toLowerCase();
}

export function isWindowsLikePath(path: string): boolean {""",
        """function normalizeSegment(segment: string, caseSensitive: boolean): string {
  return caseSensitive ? segment : segment.toLowerCase();
}

function pathSegmentsMatch(
  left: string[],
  right: string[],
  length: number,
  caseSensitive: boolean
): boolean {
  if (left.length < length || right.length < length) {
    return false;
  }
  for (let i = 0; i < length; i++) {
    if (
      normalizeSegment(left[i], caseSensitive) !==
      normalizeSegment(right[i], caseSensitive)
    ) {
      return false;
    }
  }
  return true;
}

export function isWindowsLikePath(path: string): boolean {""",
    )
    content = content.replace(
        """  if (
    pathSegments.length <= rootSegments.length ||
    !rootSegments.every((segment, index) => {
      return normalizeSegment(segment, caseSensitive) ===
        normalizeSegment(pathSegments[index], caseSensitive);
    })
  ) {
    return path;
  }""",
        """  if (
    pathSegments.length <= rootSegments.length ||
    !pathSegmentsMatch(
      pathSegments,
      rootSegments,
      rootSegments.length,
      caseSensitive
    )
  ) {
    return path;
  }""",
    )
    content = content.replace(
        """  if (candidateSegments.length < parentSegments.length) {
    return false;
  }

  return parentSegments.every((segment, index) => {
    return normalizeSegment(segment, caseSensitive) ===
      normalizeSegment(candidateSegments[index], caseSensitive);
  });""",
        """  return pathSegmentsMatch(
    candidateSegments,
    parentSegments,
    parentSegments.length,
    caseSensitive
  );""",
    )
    content = content.replace(
        """  if (
    pathSegments.length < oldPrefixSegments.length ||
    !oldPrefixSegments.every((segment, index) => {
      return normalizeSegment(segment, caseSensitive) ===
        normalizeSegment(pathSegments[index], caseSensitive);
    })
  ) {
    return path;
  }""",
        """  if (
    !pathSegmentsMatch(
      pathSegments,
      oldPrefixSegments,
      oldPrefixSegments.length,
      caseSensitive
    )
  ) {
    return path;
  }""",
    )
    write("lib/paths.ts", content)
    print("fixed paths.ts comparisons")


# ---------------------------------------------------------------------------
# 7. Performance: listOrdering map lookup
# ---------------------------------------------------------------------------
def fix_list_ordering() -> None:
    replace(
        "lib/listOrdering.ts",
        """  let activeProfile: ConfigProfile | null = null;

  for (const group of groups) {
    const sourceIndex = group.items.findIndex(
      (profile) => profile.name === activeProfileName
    );

    if (sourceIndex === -1) {
      continue;
    }

    [activeProfile] = group.items.splice(sourceIndex, 1);
    break;
  }

  if (!activeProfile) {
    return [...profiles];
  }""",
        """  const profileLocationByName = new Map<
    string,
    { group: (typeof groups)[number]; index: number }
  >();
  for (const group of groups) {
    group.items.forEach((profile, index) => {
      profileLocationByName.set(profile.name, { group, index });
    });
  }

  const activeLocation = profileLocationByName.get(activeProfileName);
  if (!activeLocation) {
    return [...profiles];
  }

  const { group: activeGroup, index: activeIndex } = activeLocation;
  const [activeProfile] = activeGroup.items.splice(activeIndex, 1);""",
    )
    print("fixed listOrdering map lookup")


# ---------------------------------------------------------------------------
# 8. Performance: .pi/extensions flatMap replacements
# ---------------------------------------------------------------------------
def fix_pi_extensions() -> None:
    content = read("../.pi/extensions/trellis/index.ts")
    content = content.replace(
        """        cfg.fallbackModels = v
          .trim()
          .replace(/^\\[|\\]$/g, "")
          .split(",")
          .map((s) => s.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean);""",
        """        cfg.fallbackModels = v
          .trim()
          .replace(/^\\[|\\]$/g, "")
          .split(",")
          .flatMap((s) => {
            const trimmed = s.trim().replace(/^["']|["']$/g, "");
            return trimmed ? [trimmed] : [];
          });""",
    )
    content = content.replace(
        '      const prompts = input.prompts?.map((p) => p.trim()).filter(Boolean);',
        """      const prompts = input.prompts?.flatMap((p) => {
        const trimmed = p.trim();
        return trimmed ? [trimmed] : [];
      });""",
    )
    content = content.replace(
        """    const keys = readdirSync(dir)
      .filter(
        (f) => f.endsWith(".json") && sessionHasTask(root, f.slice(0, -5)),
      )
      .map((f) => f.slice(0, -5));""",
        """    const keys = readdirSync(dir).flatMap((f) => {
      if (f.endsWith(".json") && sessionHasTask(root, f.slice(0, -5))) {
        return [f.slice(0, -5)];
      }
      return [];
    });""",
    )
    (ROOT / ".pi/extensions/trellis/index.ts").write_text(content, encoding="utf-8")
    print("fixed .pi/extensions flatMap")


# ---------------------------------------------------------------------------
# 9. Performance: lazy ref initializers
# ---------------------------------------------------------------------------
def fix_lazy_refs() -> None:
    # create helper if missing
    helper = SRC / "hooks/useLazyRef.ts"
    if not helper.exists():
        helper.write_text(
            """import { useRef } from "react";

const UNSET = Symbol("lazy-ref-unset");

export function useLazyRef<T>(init: () => T): React.MutableRefObject<T> {
  const ref = useRef<T | typeof UNSET>(UNSET);
  if (ref.current === UNSET) {
    ref.current = init();
  }
  return ref as React.MutableRefObject<T>;
}
""",
            encoding="utf-8",
        )

    # useFloatingPosition
    replace(
        "components/layout/useFloatingPosition.ts",
        'import { useCallback, useRef, useState } from "react";',
        'import { useCallback, useRef, useState } from "react";\n\nimport { useLazyRef } from "@/hooks/useLazyRef";',
    )
    replace(
        "components/layout/useFloatingPosition.ts",
        """  const previousFloatingRectRef = useRef<FloatingCardRectDraft | null>(null);
  const floatingTargetRectRef = useRef<FloatingCardRect>(createHiddenFloatingCardRect());
  const floatingRenderRectRef = useRef<FloatingCardRect>(createHiddenFloatingCardRect());""",
        """  const previousFloatingRectRef = useRef<FloatingCardRectDraft | null>(null);
  const floatingTargetRectRef = useLazyRef<FloatingCardRect>(createHiddenFloatingCardRect);
  const floatingRenderRectRef = useLazyRef<FloatingCardRect>(createHiddenFloatingCardRect);""",
    )

    # useFloatingDynamics
    replace(
        "components/layout/useFloatingDynamics.ts",
        'import { useCallback, useRef } from "react";',
        'import { useCallback, useRef } from "react";\n\nimport { useLazyRef } from "@/hooks/useLazyRef";',
    )
    replace(
        "components/layout/useFloatingDynamics.ts",
        '  const dynamicsRef = useRef<FloatingCardDynamics>(createNeutralDynamics());',
        '  const dynamicsRef = useLazyRef<FloatingCardDynamics>(createNeutralDynamics);',
    )

    # useProfileOrdering
    replace(
        "features/config/useProfileOrdering.ts",
        'import { useCallback, useRef } from "react";',
        'import { useCallback, useRef } from "react";\n\nimport { useLazyRef } from "@/hooks/useLazyRef";',
    )
    replace(
        "features/config/useProfileOrdering.ts",
        """  const reorderProfilesQueueRef = useRef<Promise<void>>(Promise.resolve());
  const selectedRepoIdRef = useRef(selectedRepoId);
  selectedRepoIdRef.current = selectedRepoId;""",
        """  const reorderProfilesQueueRef = useLazyRef<Promise<void>>(() => Promise.resolve());
  const selectedRepoIdRef = useLazyRef<string | null>(() => selectedRepoId);
  selectedRepoIdRef.current = selectedRepoId;""",
    )

    # useProfileListState
    content = read("hooks/useProfileListState.ts")
    content = content.replace(
        'import { toast } from "sonner";',
        'import { toast } from "sonner";\n\nimport { useLazyRef } from "@/hooks/useLazyRef";',
    )
    content = content.replace(
        """  const loadProfilesRequestIdRef = useRef(0);
  const reorderProfilesQueueRef = useRef<Promise<void>>(Promise.resolve());
  const profilesCacheRef = useRef<Record<string, ProfileListSnapshot>>({});
  const selectedRepoIdRef = useRef(selectedRepoId);""",
        """  const loadProfilesRequestIdRef = useLazyRef<number>(() => 0);
  const reorderProfilesQueueRef = useLazyRef<Promise<void>>(() => Promise.resolve());
  const profilesCacheRef = useLazyRef<Record<string, ProfileListSnapshot>>(() => ({}));
  const selectedRepoIdRef = useLazyRef<string | null>(() => selectedRepoId);""",
    )
    write("hooks/useProfileListState.ts", content)
    print("fixed lazy ref initializers")


# ---------------------------------------------------------------------------
# 10. Accessibility & maintainability quick wins
# ---------------------------------------------------------------------------
def fix_card_title() -> None:
    replace(
        "components/ui/card.tsx",
        """const CardTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
      className={cn(
        "font-display text-[18px] font-semibold leading-none tracking-tight",
        className
      )}
    {...props}
  />
));""",
        """const CardTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, children, ...props }, ref) =>
  children ? (
    <h3
      ref={ref}
      className={cn(
        "font-display text-[18px] font-semibold leading-none tracking-tight",
        className
      )}
      {...props}
    >
      {children}
    </h3>
  ) : null
);""",
    )
    print("fixed CardTitle empty heading")


def fix_role_over_tag() -> None:
    replace(
        "components/publish/MapParameter.tsx",
        '<div className="space-y-2" role="group" aria-labelledby={fieldLabelId}>',
        '<fieldset className="space-y-2" aria-labelledby={fieldLabelId}>',
    )
    replace(
        "components/publish/MapParameter.tsx",
        "      </div>\n    </div>\n  );\n}",
        "      </fieldset>\n    </div>\n  );\n}",
    )
    replace(
        "components/publish/ArrayParameter.tsx",
        '<div className="space-y-2" role="group" aria-labelledby={fieldLabelId}>',
        '<fieldset className="space-y-2" aria-labelledby={fieldLabelId}>',
    )
    replace(
        "components/publish/ArrayParameter.tsx",
        "      </div>\n    </div>\n  );\n}",
        "      </fieldset>\n    </div>\n  );\n}",
    )
    replace(
        "components/publish/PublishRunCard.tsx",
        """          <div
            data-testid="publish-status-panel"
            role="status"
            aria-live="polite"
            className={cn(
              "glass-surface rounded-2xl border p-4",
              statusMeta.panelClassName
            )}
          >""",
        """          <output
            data-testid="publish-status-panel"
            aria-live="polite"
            className={cn(
              "glass-surface rounded-2xl border p-4",
              statusMeta.panelClassName
            )}
          >""",
    )
    replace(
        "components/publish/PublishRunCard.tsx",
        "          </div>\n\n          {failureMessage ? (",
        "          </output>\n\n          {failureMessage ? (",
    )
    print("fixed role-over-tag")


def fix_execution_history_pure_function() -> None:
    content = read("components/publish/ExecutionHistoryCard.tsx")
    content = content.replace(
        'import type { HandoffSnippetFormat } from "@/lib/handoffSnippet";',
        """import type { HandoffSnippetFormat } from "@/lib/handoffSnippet";

function getExecutionFailureReason(record: ExecutionRecord): string | null {
  if (record.success || record.cancelled) {
    return null;
  }

  return (
    record.error?.trim() ||
    record.failureSignature?.trim() ||
    record.outputExcerpt?.trim() ||
    null
  );
}""",
    )
    content = content.replace(
        """  const getFailureReason = (record: ExecutionRecord) => {
    if (record.success || record.cancelled) {
      return null;
    }

    return (
      record.error?.trim() ||
      record.failureSignature?.trim() ||
      record.outputExcerpt?.trim() ||
      null
    );
  };

  return (""",
        "  return (",
    )
    content = content.replace(
        "const failureReason = getFailureReason(record);",
        "const failureReason = getExecutionFailureReason(record);",
    )
    write("components/publish/ExecutionHistoryCard.tsx", content)
    print("fixed ExecutionHistoryCard pure function")


# ---------------------------------------------------------------------------
# 11. Performance: array lookup / indexOf inside loops
# ---------------------------------------------------------------------------
def fix_publish_execution_record() -> None:
    replace(
        "features/history/publishExecutionRecord.ts",
        """  let cursor = 0;
  while (cursor < outputLog.length) {
    const nextBreak = outputLog.indexOf("\\n", cursor);
    const line =
      nextBreak === -1
        ? outputLog.slice(cursor)
        : outputLog.slice(cursor, nextBreak);

    if (line.startsWith("$ ")) {
      return line;
    }

    if (nextBreak === -1) {
      break;
    }

    cursor = nextBreak + 1;
  }

  return null;""",
        """  for (const line of outputLog.split("\\n")) {
    if (line.startsWith("$ ")) {
      return line;
    }
  }

  return null;""",
    )
    print("fixed publishExecutionRecord loop")


def fix_project_publish_profile_xml() -> None:
    replace(
        "lib/projectPublishProfileXml.ts",
        '      if (entry.path.includes(".")) {\n        continue;\n      }',
        '      if (/\\./.test(entry.path)) {\n        continue;\n      }',
    )
    print("fixed projectPublishProfileXml loop lookup")


# ---------------------------------------------------------------------------
# 12. Performance: await before guard -> promise chains
# ---------------------------------------------------------------------------
def fix_publish_config_panel_await() -> None:
    content = read("components/layout/PublishConfigPanel.tsx")
    content = content.replace(
        """      try {
        const resolvedProfile = await resolveDotnetProjectProfile({
          projectInfo: {
            root_path: "",
            project_file: projectFilePath,
            target_frameworks: projectFrameworkOptions,
          },
          profileName,
        });

        if (latestProjectProfileRequestId.current !== requestId) {
          return;
        }

        setProjectProfileViewerState({
          status: "ready",
          profileName: resolvedProfile.profileName,
          filePath: resolvedProfile.filePath,
          editableConfig: resolvedProfile.editableConfig,
          parsedProfile: resolvedProfile.parsedProfile,
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : extractInvokeErrorMessage(error);

        if (latestProjectProfileRequestId.current !== requestId) {
          return;
        }

        setProjectProfileViewerState({
          status: "error",
          profileName,
          errorMessage,
        });
        toast.error(t.loadConfigFailed || "加载配置失败", {
          description: errorMessage,
        });
      }
    },""",
        """      resolveDotnetProjectProfile({
        projectInfo: {
          root_path: "",
          project_file: projectFilePath,
          target_frameworks: projectFrameworkOptions,
        },
        profileName,
      })
        .then((resolvedProfile) => {
          if (latestProjectProfileRequestId.current !== requestId) {
            return;
          }

          setProjectProfileViewerState({
            status: "ready",
            profileName: resolvedProfile.profileName,
            filePath: resolvedProfile.filePath,
            editableConfig: resolvedProfile.editableConfig,
            parsedProfile: resolvedProfile.parsedProfile,
          });
        })
        .catch((error) => {
          if (latestProjectProfileRequestId.current !== requestId) {
            return;
          }

          const errorMessage =
            error instanceof Error
              ? error.message
              : extractInvokeErrorMessage(error);

          setProjectProfileViewerState({
            status: "error",
            profileName,
            errorMessage,
          });
          toast.error(t.loadConfigFailed || "加载配置失败", {
            description: errorMessage,
          });
        });
    },""",
    )
    write("components/layout/PublishConfigPanel.tsx", content)
    print("fixed PublishConfigPanel await guard")


def fix_publish_state_slice_await() -> None:
    content = (ROOT / "src/stores/publishStateSlice.ts").read_text(encoding="utf-8")
    content = content.replace(
        """    recentMutationQueue = recentMutationQueue
      .catch(() => undefined)
      .then(async () => {
        try {
          const nextState = await mutation();
          if (options?.applyState === false) {
            return;
          }
          set((prev) => mergeRecentPublishState(prev, nextState));
        } catch (err) {
          await handlePersistenceFailure(errorMessage, err);
        }
      });""",
        """    recentMutationQueue = recentMutationQueue
      .catch(() => undefined)
      .then(() => mutation())
      .then((nextState) => {
        if (options?.applyState === false) {
          return;
        }
        set((prev) => mergeRecentPublishState(prev, nextState));
      })
      .catch((err) => handlePersistenceFailure(errorMessage, err));""",
    )
    (ROOT / "src/stores/publishStateSlice.ts").write_text(content, encoding="utf-8")
    print("fixed publishStateSlice await guard")


# ---------------------------------------------------------------------------
# 13. CI: reorder workflow & ignore scripts
# ---------------------------------------------------------------------------
def fix_workflow() -> None:
    wf = ROOT / ".github/workflows/build-release.yml"
    content = wf.read_text(encoding="utf-8")
    content = content.replace(
        """    env:
      HAS_APPLE_CERT: ${{ secrets.APPLE_CERTIFICATE != '' && secrets.APPLE_CERTIFICATE_PASSWORD != '' && secrets.KEYCHAIN_PASSWORD != '' }}
      HAS_WINDOWS_CERT: ${{ secrets.WINDOWS_CERTIFICATE != '' && secrets.WINDOWS_CERTIFICATE_PASSWORD != '' }}
      HAS_APPLE_SIGNING: ${{ secrets.APPLE_ID != '' && secrets.APPLE_PASSWORD != '' && secrets.APPLE_SIGNING_IDENTITY != '' }}
      TAURI_UPDATER_PUBKEY: ${{ secrets.TAURI_UPDATER_PUBKEY }}
      TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}""",
        """    env:
      HAS_APPLE_CERT: ${{ secrets.APPLE_CERTIFICATE != '' && secrets.APPLE_CERTIFICATE_PASSWORD != '' && secrets.KEYCHAIN_PASSWORD != '' }}
      HAS_WINDOWS_CERT: ${{ secrets.WINDOWS_CERTIFICATE != '' && secrets.WINDOWS_CERTIFICATE_PASSWORD != '' }}
      HAS_APPLE_SIGNING: ${{ secrets.APPLE_ID != '' && secrets.APPLE_PASSWORD != '' && secrets.APPLE_SIGNING_IDENTITY != '' }}""",
    )
    content = content.replace(
        """      - name: Setup Node
        uses: actions/setup-node@v5
        with:
          node-version: "20"
          cache: "pnpm"

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.os == 'macos-latest' && 'aarch64-apple-darwin,x86_64-apple-darwin' || '' }}

      - name: Import Apple Developer Certificate
        if: matrix.os == 'macos-latest' && env.HAS_APPLE_CERT == 'true'
        env:
          APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
          APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
          KEYCHAIN_PASSWORD: ${{ secrets.KEYCHAIN_PASSWORD }}
        run: |
          echo "$APPLE_CERTIFICATE" | base64 --decode > "certificate.p12"
          security create-keychain -p "$KEYCHAIN_PASSWORD" "build.keychain"
          security default-keychain -s "build.keychain"
          security unlock-keychain -p "$KEYCHAIN_PASSWORD" "build.keychain"
          security set-keychain-settings -t 3600 -u "build.keychain"
          security import "certificate.p12" -k "build.keychain" -P "$APPLE_CERTIFICATE_PASSWORD" -T /usr/bin/codesign
          security set-keypartition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "build.keychain"
          security find-identity -v -p codesigning "build.keychain"

      - name: Import Windows Certificate
        if: matrix.os == 'windows-latest' && env.HAS_WINDOWS_CERT == 'true'
        env:
          WINDOWS_CERTIFICATE: ${{ secrets.WINDOWS_CERTIFICATE }}
          WINDOWS_CERTIFICATE_PASSWORD: ${{ secrets.WINDOWS_CERTIFICATE_PASSWORD }}
        run: |
          New-Item -ItemType directory -Path "certificate"
          Set-Content -Path "certificate/tempCert.txt" -Value $env:WINDOWS_CERTIFICATE
          certutil -decode "certificate/tempCert.txt" "certificate/certificate.pfx"
          Remove-Item -path "certificate" -include "tempCert.txt"
          Import-PfxCertificate -FilePath "certificate/certificate.pfx" -CertStoreLocation "Cert:\\CurrentUser\\My" -Password (ConvertTo-SecureString -String $env:WINDOWS_CERTIFICATE_PASSWORD -Force -AsPlainText)

      - name: Install Linux dependencies
        if: matrix.os == 'ubuntu-latest'
        run: |
          sudo apt-get update
          sudo apt-get install -y \\
            libwebkit2gtk-4.1-dev \\
            libgtk-3-dev \\
            libappindicator3-dev \\
            librsvg2-dev \\
            patchelf

      - name: Install dependencies
        run: pnpm install --frozen-lockfile""",
        """      - name: Setup Node
        uses: actions/setup-node@v5
        with:
          node-version: "20"
          cache: "pnpm"

      - name: Install dependencies
        run: pnpm install --frozen-lockfile --ignore-scripts

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.os == 'macos-latest' && 'aarch64-apple-darwin,x86_64-apple-darwin' || '' }}

      - name: Install Linux dependencies
        if: matrix.os == 'ubuntu-latest'
        run: |
          sudo apt-get update
          sudo apt-get install -y \\
            libwebkit2gtk-4.1-dev \\
            libgtk-3-dev \\
            libappindicator3-dev \\
            librsvg2-dev \\
            patchelf

      - name: Import Apple Developer Certificate
        if: matrix.os == 'macos-latest' && env.HAS_APPLE_CERT == 'true'
        env:
          APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
          APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
          KEYCHAIN_PASSWORD: ${{ secrets.KEYCHAIN_PASSWORD }}
        run: |
          echo "$APPLE_CERTIFICATE" | base64 --decode > "certificate.p12"
          security create-keychain -p "$KEYCHAIN_PASSWORD" "build.keychain"
          security default-keychain -s "build.keychain"
          security unlock-keychain -p "$KEYCHAIN_PASSWORD" "build.keychain"
          security set-keychain-settings -t 3600 -u "build.keychain"
          security import "certificate.p12" -k "build.keychain" -P "$APPLE_CERTIFICATE_PASSWORD" -T /usr/bin/codesign
          security set-keypartition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "build.keychain"
          security find-identity -v -p codesigning "build.keychain"

      - name: Import Windows Certificate
        if: matrix.os == 'windows-latest' && env.HAS_WINDOWS_CERT == 'true'
        env:
          WINDOWS_CERTIFICATE: ${{ secrets.WINDOWS_CERTIFICATE }}
          WINDOWS_CERTIFICATE_PASSWORD: ${{ secrets.WINDOWS_CERTIFICATE_PASSWORD }}
        run: |
          New-Item -ItemType directory -Path "certificate"
          Set-Content -Path "certificate/tempCert.txt" -Value $env:WINDOWS_CERTIFICATE
          certutil -decode "certificate/tempCert.txt" "certificate/certificate.pfx"
          Remove-Item -path "certificate" -include "tempCert.txt"
          Import-PfxCertificate -FilePath "certificate/certificate.pfx" -CertStoreLocation "Cert:\\CurrentUser\\My" -Password (ConvertTo-SecureString -String $env:WINDOWS_CERTIFICATE_PASSWORD -Force -AsPlainText)""",
    )
    content = content.replace(
        """      - name: Build (macOS signed)
        if: matrix.os == 'macos-latest' && env.HAS_APPLE_SIGNING == 'true'
        env:
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_PASSWORD: ${{ secrets.APPLE_PASSWORD }}
          APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
        run: pnpm build:updater -- ${{ matrix.tauri_args }}""",
        """      - name: Build (macOS signed)
        if: matrix.os == 'macos-latest' && env.HAS_APPLE_SIGNING == 'true'
        env:
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_PASSWORD: ${{ secrets.APPLE_PASSWORD }}
          APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
          TAURI_UPDATER_PUBKEY: ${{ secrets.TAURI_UPDATER_PUBKEY }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        run: pnpm build:updater -- ${{ matrix.tauri_args }}""",
    )
    content = content.replace(
        """      - name: Build (macOS unsigned)
        if: matrix.os == 'macos-latest' && env.HAS_APPLE_SIGNING != 'true'
        run: pnpm build:updater -- ${{ matrix.tauri_args }}

      - name: Build
        if: matrix.os != 'macos-latest'
        run: pnpm build:updater -- ${{ matrix.tauri_args }}""",
        """      - name: Build (macOS unsigned)
        if: matrix.os == 'macos-latest' && env.HAS_APPLE_SIGNING != 'true'
        env:
          TAURI_UPDATER_PUBKEY: ${{ secrets.TAURI_UPDATER_PUBKEY }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        run: pnpm build:updater -- ${{ matrix.tauri_args }}

      - name: Build
        if: matrix.os != 'macos-latest'
        env:
          TAURI_UPDATER_PUBKEY: ${{ secrets.TAURI_UPDATER_PUBKEY }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        run: pnpm build:updater -- ${{ matrix.tauri_args }}""",
    )
    wf.write_text(content, encoding="utf-8")
    print("fixed workflow secret boundary")


def main() -> None:
    fix_jsx_element_return_types()
    fix_use_list_reorder_motion()
    fix_release_checklist_dialog()
    fix_environment_check_dialog()
    fix_use_publish_validate()
    fix_use_repository_view_state()
    fix_profile_list_snapshot()
    fix_use_project_shell_state()
    fix_app_empty_fallback()
    fix_paths_comparison()
    fix_list_ordering()
    fix_pi_extensions()
    fix_lazy_refs()
    fix_card_title()
    fix_role_over_tag()
    fix_execution_history_pure_function()
    fix_publish_execution_record()
    fix_project_publish_profile_xml()
    fix_publish_config_panel_await()
    fix_publish_state_slice_await()
    fix_workflow()
    print("done")


if __name__ == "__main__":
    main()
