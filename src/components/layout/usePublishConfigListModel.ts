import { useEffect, useMemo } from "react";

import {
  buildProfileGroups,
  type ProfileGroupBucket,
} from "@/lib/listOrdering";
import {
  createProjectProfileConfigKey,
  createRecentConfigRenderId,
  createUserProfileConfigKey,
  normalizeRenderableConfigId,
  parsePublishConfigKey,
  resolveSelectedPublishConfigKey,
} from "@/lib/publishConfigIdentity";
import type { ConfigProfile } from "@/lib/store";

export const ALL_GROUP_FILTER = "__all__";
export const PROJECT_GROUP_FILTER = "__project_profiles__";

export type GroupFilterValue =
  | typeof ALL_GROUP_FILTER
  | typeof PROJECT_GROUP_FILTER
  | `profile-group:${string}`;

export interface PreferredSelectedRenderAnchor {
  repoId: string | null;
  renderId: string;
}

export interface GroupFilterOption {
  value: GroupFilterValue;
  label: string;
  count: number;
}

export interface PublishConfigRecentItem {
  key: string;
  name: string;
  description?: string;
  kind: "pubxml" | "userprofile";
  profile?: ConfigProfile;
}

export function createProfileGroupFilterValue(
  groupName: string
): GroupFilterValue {
  return `profile-group:${groupName}`;
}

function profileMatchesQuery(profile: ConfigProfile, query: string) {
  if (!query) {
    return true;
  }

  return (
    profile.name.toLowerCase().includes(query) ||
    profile.providerId.toLowerCase().includes(query) ||
    (profile.profileGroup || "").toLowerCase().includes(query)
  );
}

function projectProfileMatchesQuery(profileName: string, query: string) {
  return !query || profileName.toLowerCase().includes(query);
}

function buildRecentItems(params: {
  recentConfigKeys: readonly string[];
  profileMap: ReadonlyMap<string, ConfigProfile>;
  pubxmlSet: ReadonlySet<string>;
}): PublishConfigRecentItem[] {
  const items: PublishConfigRecentItem[] = [];

  for (const recentConfigKey of params.recentConfigKeys) {
    if (items.length >= 6) {
      break;
    }

    const identity = parsePublishConfigKey(recentConfigKey);

    if (identity?.kind === "project-profile") {
      if (!params.pubxmlSet.has(identity.profileName)) {
        continue;
      }

      items.push({
        key: recentConfigKey,
        kind: "pubxml",
        name: identity.profileName,
      });
      continue;
    }

    if (identity?.kind === "user-profile") {
      const profile = params.profileMap.get(identity.profileName);
      if (!profile) {
        continue;
      }

      items.push({
        key: recentConfigKey,
        kind: "userprofile",
        name: profile.name,
        description: profile.providerId,
        profile,
      });
    }
  }

  return items;
}

function buildGroupFilterOptions(params: {
  profiles: readonly ConfigProfile[];
  projectPublishProfileCount: number;
  defaultGroupName: string;
  allConfigsLabel: string;
  projectProfilesLabel: string;
}): GroupFilterOption[] {
  const profileGroupOptions = buildProfileGroups(
    params.profiles,
    params.defaultGroupName
  ).map((group) => ({
    value: createProfileGroupFilterValue(group.groupName),
    label: group.groupName,
    count: group.items.length,
  }));

  const options: GroupFilterOption[] = [
    {
      value: ALL_GROUP_FILTER,
      label: params.allConfigsLabel,
      count: params.projectPublishProfileCount + params.profiles.length,
    },
  ];

  if (params.projectPublishProfileCount > 0) {
    options.push({
      value: PROJECT_GROUP_FILTER,
      label: params.projectProfilesLabel,
      count: params.projectPublishProfileCount,
    });
  }

  return [...options, ...profileGroupOptions];
}

function getVisibleProjectProfiles(params: {
  groupFilterValue: GroupFilterValue;
  projectProfiles: readonly string[];
}): string[] {
  if (
    params.groupFilterValue !== ALL_GROUP_FILTER &&
    params.groupFilterValue !== PROJECT_GROUP_FILTER
  ) {
    return [];
  }

  return [...params.projectProfiles];
}

function getVisibleProfileGroups(params: {
  groupFilterValue: GroupFilterValue;
  profileGroups: readonly ProfileGroupBucket[];
}): ProfileGroupBucket[] {
  if (params.groupFilterValue === ALL_GROUP_FILTER) {
    return [...params.profileGroups];
  }

  if (params.groupFilterValue === PROJECT_GROUP_FILTER) {
    return [];
  }

  return params.profileGroups.filter(
    (group) =>
      createProfileGroupFilterValue(group.groupName) === params.groupFilterValue
  );
}

function countProfiles(profileGroups: readonly ProfileGroupBucket[]) {
  return profileGroups.reduce((total, group) => total + group.items.length, 0);
}

function resolveSelectedConfigId(params: {
  isCustomMode: boolean;
  activeProfileName: string | null;
  selectedPreset: string;
  pubxmlSet: ReadonlySet<string>;
}) {
  return resolveSelectedPublishConfigKey({
    isCustomMode: params.isCustomMode,
    activeProfileName: params.activeProfileName,
    selectedPreset: params.selectedPreset,
    hasProjectProfile: (profileName) => params.pubxmlSet.has(profileName),
  });
}

function buildConfigIds(params: {
  showRecentItems: boolean;
  recentItems: readonly PublishConfigRecentItem[];
  visibleProjectProfiles: readonly string[];
  visibleProfileGroups: readonly ProfileGroupBucket[];
}) {
  const ids: string[] = [];

  if (params.showRecentItems) {
    for (const item of params.recentItems) {
      ids.push(createRecentConfigRenderId(item.key));
    }
  }

  for (const name of params.visibleProjectProfiles) {
    ids.push(createProjectProfileConfigKey(name));
  }

  for (const group of params.visibleProfileGroups) {
    for (const profile of group.items) {
      ids.push(createUserProfileConfigKey(profile.name));
    }
  }

  return ids;
}

function resolveSelectedRenderId(params: {
  selectedConfigId: string | null;
  allConfigIds: readonly string[];
  preferredSelectedRenderAnchor: PreferredSelectedRenderAnchor | null;
  selectedRepoScopeId: string | null;
}) {
  const preferredSelectedRenderId =
    params.preferredSelectedRenderAnchor?.repoId === params.selectedRepoScopeId
      ? params.preferredSelectedRenderAnchor.renderId
      : null;

  if (!params.selectedConfigId) {
    return null;
  }

  if (
    preferredSelectedRenderId &&
    normalizeRenderableConfigId(preferredSelectedRenderId) ===
      params.selectedConfigId &&
    params.allConfigIds.includes(preferredSelectedRenderId)
  ) {
    return preferredSelectedRenderId;
  }

  return params.selectedConfigId;
}

export function usePublishConfigListModel(params: {
  selectedRepoScopeId: string | null;
  selectedPreset: string;
  isCustomMode: boolean;
  activeProfileName: string | null;
  profiles: readonly ConfigProfile[];
  projectPublishProfiles: readonly string[];
  recentConfigKeys: readonly string[];
  favoriteConfigKeys: readonly string[];
  searchQuery: string;
  groupFilterValue: GroupFilterValue;
  onGroupFilterValueChange: (value: GroupFilterValue) => void;
  defaultGroupName: string;
  allConfigsLabel: string;
  projectProfilesLabel: string;
  preferredSelectedRenderAnchor: PreferredSelectedRenderAnchor | null;
  showReorderControls: boolean;
  isProfilesRefreshing: boolean;
  isProjectProfilesRefreshing: boolean;
}) {
  const { groupFilterValue, onGroupFilterValueChange } = params;
  const query = params.searchQuery.toLowerCase();
  const favoriteSet = useMemo(
    () => new Set(params.favoriteConfigKeys),
    [params.favoriteConfigKeys]
  );
  const profileMap = useMemo(
    () => new Map(params.profiles.map((profile) => [profile.name, profile])),
    [params.profiles]
  );
  const pubxmlSet = useMemo(
    () => new Set(params.projectPublishProfiles),
    [params.projectPublishProfiles]
  );
  const recentItems = useMemo(
    () =>
      buildRecentItems({
        recentConfigKeys: params.recentConfigKeys,
        profileMap,
        pubxmlSet,
      }),
    [params.recentConfigKeys, profileMap, pubxmlSet]
  );
  const filteredProfiles = useMemo(
    () => params.profiles.filter((profile) => profileMatchesQuery(profile, query)),
    [params.profiles, query]
  );
  const filteredProjectProfiles = useMemo(
    () =>
      params.projectPublishProfiles.filter((name) =>
        projectProfileMatchesQuery(name, query)
      ),
    [params.projectPublishProfiles, query]
  );
  const groupFilterOptions = useMemo(
    () =>
      buildGroupFilterOptions({
        profiles: params.profiles,
        projectPublishProfileCount: params.projectPublishProfiles.length,
        defaultGroupName: params.defaultGroupName,
        allConfigsLabel: params.allConfigsLabel,
        projectProfilesLabel: params.projectProfilesLabel,
      }),
    [
      params.allConfigsLabel,
      params.defaultGroupName,
      params.profiles,
      params.projectProfilesLabel,
      params.projectPublishProfiles.length,
    ]
  );

  useEffect(() => {
    if (
      groupFilterOptions.some(
        (option) => option.value === groupFilterValue
      )
    ) {
      return;
    }

    onGroupFilterValueChange(ALL_GROUP_FILTER);
  }, [groupFilterOptions, groupFilterValue, onGroupFilterValueChange]);

  const groupedFilteredProfiles = useMemo(
    () => buildProfileGroups(filteredProfiles, params.defaultGroupName),
    [filteredProfiles, params.defaultGroupName]
  );
  const selectedGroupFilterOption = useMemo(
    () =>
      groupFilterOptions.find(
        (option) => option.value === params.groupFilterValue
      ) ?? groupFilterOptions[0],
    [groupFilterOptions, params.groupFilterValue]
  );
  const visibleProjectProfiles = useMemo(
    () =>
      getVisibleProjectProfiles({
        groupFilterValue: params.groupFilterValue,
        projectProfiles: filteredProjectProfiles,
      }),
    [filteredProjectProfiles, params.groupFilterValue]
  );
  const visibleGroupedFilteredProfiles = useMemo(
    () =>
      getVisibleProfileGroups({
        groupFilterValue: params.groupFilterValue,
        profileGroups: groupedFilteredProfiles,
      }),
    [groupedFilteredProfiles, params.groupFilterValue]
  );
  const visibleCustomProfileCount = useMemo(
    () => countProfiles(visibleGroupedFilteredProfiles),
    [visibleGroupedFilteredProfiles]
  );
  const visibleConfigCount = visibleProjectProfiles.length + visibleCustomProfileCount;
  const showRecentItems =
    !query &&
    params.groupFilterValue === ALL_GROUP_FILTER &&
    recentItems.length > 0;
  const sortModeEnabled = params.showReorderControls;
  const recentDragEnabled =
    sortModeEnabled && showRecentItems && recentItems.length > 1;
  const projectProfileDragEnabled =
    sortModeEnabled && query.length === 0 && visibleProjectProfiles.length > 1;
  const shouldShowProjectProfilesLoadingState =
    params.isProjectProfilesRefreshing &&
    query.length === 0 &&
    (params.groupFilterValue === ALL_GROUP_FILTER ||
      params.groupFilterValue === PROJECT_GROUP_FILTER);
  const shouldShowCustomProfilesLoadingState =
    params.isProfilesRefreshing &&
    query.length === 0 &&
    params.groupFilterValue !== PROJECT_GROUP_FILTER &&
    visibleCustomProfileCount === 0;
  const customProfileDragEnabled =
    sortModeEnabled && query.length === 0 && visibleCustomProfileCount > 1;
  const selectedConfigId = useMemo(
    () =>
      resolveSelectedConfigId({
        isCustomMode: params.isCustomMode,
        activeProfileName: params.activeProfileName,
        selectedPreset: params.selectedPreset,
        pubxmlSet,
      }),
    [
      params.activeProfileName,
      params.isCustomMode,
      params.selectedPreset,
      pubxmlSet,
    ]
  );
  const allConfigIds = useMemo(
    () =>
      buildConfigIds({
        showRecentItems,
        recentItems,
        visibleProjectProfiles,
        visibleProfileGroups: visibleGroupedFilteredProfiles,
      }),
    [
      recentItems,
      showRecentItems,
      visibleGroupedFilteredProfiles,
      visibleProjectProfiles,
    ]
  );
  const selectedRenderId = useMemo(
    () =>
      resolveSelectedRenderId({
        selectedConfigId,
        allConfigIds,
        preferredSelectedRenderAnchor: params.preferredSelectedRenderAnchor,
        selectedRepoScopeId: params.selectedRepoScopeId,
      }),
    [
      allConfigIds,
      params.preferredSelectedRenderAnchor,
      params.selectedRepoScopeId,
      selectedConfigId,
    ]
  );

  return {
    query,
    favoriteSet,
    recentItems,
    groupFilterOptions,
    selectedGroupFilterOption,
    visibleProjectProfiles,
    visibleGroupedFilteredProfiles,
    visibleConfigCount,
    showRecentItems,
    sortModeEnabled,
    recentDragEnabled,
    projectProfileDragEnabled,
    customProfileDragEnabled,
    shouldShowProjectProfilesLoadingState,
    shouldShowCustomProfilesLoadingState,
    selectedConfigId,
    allConfigIds,
    selectedRenderId,
  };
}

export function usePublishConfigPreviewModel(params: {
  query: string;
  groupFilterValue: GroupFilterValue;
  defaultGroupName: string;
  showRecentItems: boolean;
  previewRecentItems: readonly PublishConfigRecentItem[];
  previewProjectProfiles: readonly string[];
  previewProfiles: readonly ConfigProfile[];
  shouldShowProjectProfilesLoadingState: boolean;
  shouldShowCustomProfilesLoadingState: boolean;
}) {
  const previewFilteredProfiles = useMemo(
    () =>
      params.previewProfiles.filter((profile) =>
        profileMatchesQuery(profile, params.query)
      ),
    [params.previewProfiles, params.query]
  );
  const previewGroupedFilteredProfiles = useMemo(
    () =>
      buildProfileGroups(previewFilteredProfiles, params.defaultGroupName),
    [previewFilteredProfiles, params.defaultGroupName]
  );
  const previewVisibleProjectProfiles = useMemo(
    () =>
      getVisibleProjectProfiles({
        groupFilterValue: params.groupFilterValue,
        projectProfiles: params.previewProjectProfiles,
      }),
    [params.groupFilterValue, params.previewProjectProfiles]
  );
  const previewVisibleGroupedFilteredProfiles = useMemo(
    () =>
      getVisibleProfileGroups({
        groupFilterValue: params.groupFilterValue,
        profileGroups: previewGroupedFilteredProfiles,
      }),
    [params.groupFilterValue, previewGroupedFilteredProfiles]
  );
  const previewConfigIds = useMemo(
    () =>
      buildConfigIds({
        showRecentItems: params.showRecentItems,
        recentItems: params.previewRecentItems,
        visibleProjectProfiles: previewVisibleProjectProfiles,
        visibleProfileGroups: previewVisibleGroupedFilteredProfiles,
      }),
    [
      params.previewRecentItems,
      params.showRecentItems,
      previewVisibleGroupedFilteredProfiles,
      previewVisibleProjectProfiles,
    ]
  );
  const hasVisiblePreviewConfigResults =
    previewVisibleProjectProfiles.length > 0 ||
    previewVisibleGroupedFilteredProfiles.length > 0;
  const shouldShowEmptyState =
    !params.showRecentItems &&
    !hasVisiblePreviewConfigResults &&
    !params.shouldShowProjectProfilesLoadingState &&
    !params.shouldShowCustomProfilesLoadingState;

  return {
    previewVisibleProjectProfiles,
    previewVisibleGroupedFilteredProfiles,
    previewConfigIds,
    shouldShowEmptyState,
  };
}
