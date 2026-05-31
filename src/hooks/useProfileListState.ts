import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import {
  getProfiles,
  reorderProfiles,
} from "@/lib/store/api";
import {
  type ConfigProfile,
  type ProfileOrderEntry,
} from "@/lib/store/types";
import {
  createProfileListSnapshot,
  EMPTY_PROFILE_LIST_SNAPSHOT,
  type ProfileListSnapshot,
} from "@/lib/profileListSnapshot";

const loadInvokeErrors = () => import("@/lib/tauri/invokeErrors");

interface TranslationMap {
  [key: string]: string | undefined;
}

export function useProfileListState(params: {
  selectedRepoId: string | null;
  profileT: TranslationMap;
  onRepositoryScopeChange: () => void;
}) {
  const { selectedRepoId, profileT, onRepositoryScopeChange } = params;
  const [visibleProfilesSnapshot, setVisibleProfilesSnapshot] =
    useState<ProfileListSnapshot>(EMPTY_PROFILE_LIST_SNAPSHOT);
  const [isProfilesRefreshing, setIsProfilesRefreshing] = useState(false);
  const loadProfilesRequestIdRef = useRef(0);
  const reorderProfilesQueueRef = useRef<Promise<void>>(Promise.resolve());
  const profilesCacheRef = useRef<Record<string, ProfileListSnapshot>>({});
  const selectedRepoIdRef = useRef(selectedRepoId);
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
      ? profilesCacheRef.current[selectedRepoId] ?? EMPTY_PROFILE_LIST_SNAPSHOT
      : EMPTY_PROFILE_LIST_SNAPSHOT;

    setVisibleProfilesSnapshot(cachedSnapshot);
    setIsProfilesRefreshing(Boolean(selectedRepoId));
    onRepositoryScopeChange();
  }, [onRepositoryScopeChange, selectedRepoId]);

  const reorderVisibleProfiles = useCallback(
    (nextProfiles: ConfigProfile[]) => {
      const repoId = selectedRepoId;
      if (!repoId) {
        return;
      }

      const nextProfileOrder: ProfileOrderEntry[] = nextProfiles.map(
        (profile) => ({
          name: profile.name,
          profileGroup: profile.profileGroup ?? null,
        })
      );

      commitProfilesSnapshot(repoId, nextProfiles);

      reorderProfilesQueueRef.current = reorderProfilesQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          try {
            await reorderProfiles({
              repoId,
              profiles: nextProfileOrder,
            });
          } catch (err) {
            console.error("保存配置排序失败:", err);

            if (selectedRepoIdRef.current === repoId) {
              await loadProfiles();
            }

            const { extractInvokeErrorMessage } = await loadInvokeErrors();
            toast.error(profileT.quickEditFailed || "更新配置文件失败", {
              description: extractInvokeErrorMessage(err),
            });
          }
        });
    },
    [
      commitProfilesSnapshot,
      loadProfiles,
      profileT.quickEditFailed,
      selectedRepoId,
    ]
  );

  return {
    profiles,
    profilesRevision,
    isProfilesRefreshing,
    loadProfiles,
    refreshProfilesAfterMutation,
    reorderVisibleProfiles,
    isCurrentRepo,
  };
}
