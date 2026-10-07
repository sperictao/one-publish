import { useCallback, useEffect, useLayoutEffect, useState } from "react";

import { useLazyRef } from "@/hooks/useLazyRef";

import { getProfiles } from "@/lib/store/api";
import { type ConfigProfile } from "@/lib/store/types";
import {
  createProfileListSnapshot,
  EMPTY_PROFILE_LIST_SNAPSHOT,
  type ProfileListSnapshot,
} from "@/lib/profileListSnapshot";

export function useProfileListState(params: {
  selectedRepoId: string | null;
  onRepositoryScopeChange: () => void;
}) {
  const { selectedRepoId, onRepositoryScopeChange } = params;
  const [visibleProfilesSnapshot, setVisibleProfilesSnapshot] =
    useState<ProfileListSnapshot>(EMPTY_PROFILE_LIST_SNAPSHOT);
  const [isProfilesRefreshing, setIsProfilesRefreshing] = useState(false);
  const loadProfilesRequestIdRef = useLazyRef<number>(() => 0);
  const profilesCacheRef = useLazyRef<Record<string, ProfileListSnapshot>>(
    () => ({})
  );
  const selectedRepoIdRef = useLazyRef<string | null>(() => selectedRepoId);
  const profiles = visibleProfilesSnapshot.profiles;
  const profilesRevision = visibleProfilesSnapshot.revision;
  selectedRepoIdRef.current = selectedRepoId;

  const isCurrentRepo = useCallback((repoId: string) => {
    return selectedRepoIdRef.current === repoId;
  }, []);

  const commitProfilesSnapshot = useCallback(
    (repoId: string, nextProfiles: ConfigProfile[]) => {
      const previousSnapshot =
        profilesCacheRef.current[repoId] ?? EMPTY_PROFILE_LIST_SNAPSHOT;
      const nextSnapshot = createProfileListSnapshot(
        nextProfiles,
        previousSnapshot
      );

      profilesCacheRef.current[repoId] = nextSnapshot;

      if (selectedRepoIdRef.current === repoId) {
        setVisibleProfilesSnapshot(nextSnapshot);
      }

      return nextSnapshot;
    },
    []
  );

  const loadProfiles = useCallback(async () => {
    const requestId = loadProfilesRequestIdRef.current + 1;
    loadProfilesRequestIdRef.current = requestId;
    const repoId = selectedRepoId;

    if (!repoId) {
      setVisibleProfilesSnapshot(EMPTY_PROFILE_LIST_SNAPSHOT);
      setIsProfilesRefreshing(false);
      return [];
    }

    const cachedSnapshot =
      profilesCacheRef.current[repoId] ?? EMPTY_PROFILE_LIST_SNAPSHOT;
    setVisibleProfilesSnapshot(cachedSnapshot);
    setIsProfilesRefreshing(true);

    try {
      const data = await getProfiles(repoId);

      if (
        loadProfilesRequestIdRef.current !== requestId ||
        selectedRepoIdRef.current !== repoId
      ) {
        return data;
      }

      commitProfilesSnapshot(repoId, data);
      setIsProfilesRefreshing(false);
      return data;
    } catch (err) {
      if (
        loadProfilesRequestIdRef.current === requestId &&
        selectedRepoIdRef.current === repoId
      ) {
        setVisibleProfilesSnapshot(cachedSnapshot);
        setIsProfilesRefreshing(false);
      }
      console.error("加载配置文件列表失败:", err);
      return [];
    }
  }, [commitProfilesSnapshot, selectedRepoId]);

  const refreshProfilesAfterMutation = useCallback(
    async (repoId: string, preFetchedProfiles?: ConfigProfile[]) => {
      if (preFetchedProfiles) {
        commitProfilesSnapshot(repoId, preFetchedProfiles);
        return preFetchedProfiles;
      }

      if (selectedRepoIdRef.current === repoId) {
        return await loadProfiles();
      }

      const data = await getProfiles(repoId);
      commitProfilesSnapshot(repoId, data);
      return data;
    },
    [commitProfilesSnapshot, loadProfiles]
  );

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  useLayoutEffect(() => {
    const cachedSnapshot = selectedRepoId
      ? (profilesCacheRef.current[selectedRepoId] ??
        EMPTY_PROFILE_LIST_SNAPSHOT)
      : EMPTY_PROFILE_LIST_SNAPSHOT;

    setVisibleProfilesSnapshot(cachedSnapshot);
    setIsProfilesRefreshing(Boolean(selectedRepoId));
    onRepositoryScopeChange();
  }, [onRepositoryScopeChange, selectedRepoId]);

  return {
    profiles,
    profilesRevision,
    isProfilesRefreshing,
    loadProfiles,
    refreshProfilesAfterMutation,
    isCurrentRepo,
    commitProfilesSnapshot,
  };
}
