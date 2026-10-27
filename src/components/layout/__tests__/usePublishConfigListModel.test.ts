import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  ALL_GROUP_FILTER,
  usePublishConfigListModel,
  usePublishConfigPreviewModel,
  type GroupFilterValue,
} from "@/components/layout/usePublishConfigListModel";
import type { ConfigProfile } from "@/lib/store/types";
import type { PublishSelectionRef } from "@/generated/tauri-contracts";

function profile(
  id: string,
  overrides: Partial<ConfigProfile> = {}
): ConfigProfile {
  return {
    id,
    revisionId: "r1",
    name: id,
    providerId: "dotnet",
    parameters: {},
    createdAt: "2026-01-01",
    isSystemDefault: false,
    externalBindingIds: [],
    profileGroup: null,
    ...overrides,
  };
}

function params(
  overrides: Partial<Parameters<typeof usePublishConfigListModel>[0]> = {}
): Parameters<typeof usePublishConfigListModel>[0] {
  return {
    selectedRepoScopeId: "repo-1",
    selection: null,
    activeProfileName: null,
    profiles: [],
    projectPublishProfiles: [],
    recentConfigKeys: [],
    favoriteConfigKeys: [],
    searchQuery: "",
    groupFilterValue: ALL_GROUP_FILTER,
    onGroupFilterValueChange: vi.fn(),
    defaultGroupName: "Default",
    allConfigsLabel: "All",
    projectProfilesLabel: "Project",
    preferredSelectedRenderAnchor: null,
    showReorderControls: false,
    isProfilesRefreshing: false,
    isProjectProfilesRefreshing: false,
    ...overrides,
  };
}

describe("usePublishConfigListModel", () => {
  it("matches profiles by provider id and group when the name misses", () => {
    const byProvider = profile("p-1", { name: "alpha", providerId: "cargo" });
    const byGroup = profile("p-2", {
      name: "beta",
      profileGroup: "Release Builds",
    });
    const miss = profile("p-3", { name: "gamma" });

    const { result } = renderHook(() =>
      usePublishConfigListModel(
        params({
          profiles: [byProvider, byGroup, miss],
          searchQuery: "cargo",
        })
      )
    );

    expect(
      result.current.visibleGroupedFilteredProfiles.flatMap((group) =>
        group.items.map((item) => item.id)
      )
    ).toEqual(["p-1"]);
  });

  it("matches profiles by group name", () => {
    const byGroup = profile("p-2", {
      name: "beta",
      profileGroup: "Release Builds",
    });
    const miss = profile("p-3", { name: "gamma" });

    const { result } = renderHook(() =>
      usePublishConfigListModel(
        params({
          profiles: [byGroup, miss],
          searchQuery: "release",
        })
      )
    );

    expect(
      result.current.visibleGroupedFilteredProfiles.flatMap((group) =>
        group.items.map((item) => item.id)
      )
    ).toEqual(["p-2"]);
  });

  it("caps recent items at six and skips stale keys", () => {
    const profiles = Array.from({ length: 7 }, (_, i) => profile(`p-${i}`));
    const profileMapIds = profiles.map((item) => `userprofile:${item.id}`);

    const { result } = renderHook(() =>
      usePublishConfigListModel(
        params({
          profiles,
          recentConfigKeys: [
            "userprofile:p-0",
            "pubxml:Missing-Profile",
            "userprofile:not-in-map",
            ...profileMapIds.slice(1),
          ],
          projectPublishProfiles: ["Release"],
        })
      )
    );

    expect(result.current.recentItems).toHaveLength(6);
    expect(
      result.current.recentItems.every((item) => item.kind === "userprofile")
    ).toBe(true);
  });

  it("filters project profiles by the search query", () => {
    const { result } = renderHook(() =>
      usePublishConfigListModel(
        params({
          projectPublishProfiles: ["Release", "Debug"],
          searchQuery: "rel",
        })
      )
    );

    expect(result.current.visibleProjectProfiles).toEqual(["Release"]);
  });

  it("skips recent keys that are neither pubxml nor user profiles", () => {
    const { result } = renderHook(() =>
      usePublishConfigListModel(
        params({
          recentConfigKeys: ["preset:fast", "userprofile:p-1"],
          profiles: [profile("p-1")],
        })
      )
    );

    expect(result.current.recentItems).toHaveLength(1);
    expect(result.current.recentItems[0].key).toBe("userprofile:p-1");
  });

  it("keeps pubxml recent items only when the project profile still exists", () => {
    const { result } = renderHook(() =>
      usePublishConfigListModel(
        params({
          recentConfigKeys: ["pubxml:Release", "pubxml:Gone"],
          projectPublishProfiles: ["Release"],
        })
      )
    );

    expect(result.current.recentItems).toEqual([
      { key: "pubxml:Release", kind: "pubxml", name: "Release" },
    ]);
  });

  it("hides project profiles and profile groups under non-matching filters", () => {
    const groups: GroupFilterValue[] = [
      "profile-group:Team",
      "__project_profiles__",
    ];

    for (const groupFilterValue of groups) {
      const { result } = renderHook(() =>
        usePublishConfigListModel(
          params({
            profiles: [profile("p-1", { profileGroup: "Team" })],
            projectPublishProfiles: ["Release"],
            groupFilterValue,
          })
        )
      );

      if (groupFilterValue === "profile-group:Team") {
        expect(result.current.visibleProjectProfiles).toEqual([]);
        expect(
          result.current.visibleGroupedFilteredProfiles.flatMap((group) =>
            group.items.map((item) => item.id)
          )
        ).toEqual(["p-1"]);
      } else {
        expect(result.current.visibleProjectProfiles).toEqual(["Release"]);
        expect(result.current.visibleGroupedFilteredProfiles).toEqual([]);
      }
    }
  });

  it("resets an unknown group filter back to all", () => {
    const onGroupFilterValueChange = vi.fn();
    renderHook(() =>
      usePublishConfigListModel(
        params({
          profiles: [profile("p-1", { profileGroup: "Team" })],
          groupFilterValue: "profile-group:Removed",
          onGroupFilterValueChange,
        })
      )
    );

    expect(onGroupFilterValueChange).toHaveBeenCalledWith(ALL_GROUP_FILTER);
  });

  it("falls back to the first option when the filter has no matching option", () => {
    const onGroupFilterValueChange = vi.fn();
    const { result } = renderHook(() =>
      usePublishConfigListModel(
        params({
          profiles: [profile("p-1")],
          groupFilterValue: "profile-group:Removed",
          onGroupFilterValueChange,
        })
      )
    );

    expect(result.current.selectedGroupFilterOption?.value).toBe(
      ALL_GROUP_FILTER
    );
  });

  it("shows project-profile loading only on all/project filters without query", () => {
    const base = {
      isProjectProfilesRefreshing: true,
      searchQuery: "",
    };

    const { result, rerender } = renderHook(
      (props) => usePublishConfigListModel(props),
      {
        initialProps: params({
          ...base,
          groupFilterValue: "__project_profiles__",
        }),
      }
    );
    expect(result.current.shouldShowProjectProfilesLoadingState).toBe(true);

    rerender(
      params({
        ...base,
        searchQuery: "x",
      })
    );
    expect(result.current.shouldShowProjectProfilesLoadingState).toBe(false);
  });

  it("resolves project-profile selections through the pubxml set", () => {
    const selection: PublishSelectionRef = {
      kind: "projectProfile",
      providerId: "dotnet",
      reference: "Release",
    };
    const { result, rerender } = renderHook(
      (props) => usePublishConfigListModel(props),
      {
        initialProps: params({
          selection,
          projectPublishProfiles: ["Release"],
        }),
      }
    );

    expect(result.current.selectedConfigId).toBe("pubxml:Release");

    rerender(params({ selection, projectPublishProfiles: ["Other"] }));
    expect(result.current.selectedConfigId).not.toBe("pubxml:Release");
  });

  it("falls back to the selected config id when the anchor is stale", () => {
    const selection: PublishSelectionRef = {
      kind: "revision",
      configurationId: "p-1",
    };
    const { result } = renderHook(() =>
      usePublishConfigListModel(
        params({
          profiles: [profile("p-1")],
          selection,
          preferredSelectedRenderAnchor: {
            repoId: "other-repo",
            renderId: "userprofile:p-1",
          },
        })
      )
    );

    expect(result.current.selectedRenderId).toBe("userprofile:p-1");
  });

  it("enables drag controls only in sort mode with enough visible items", () => {
    const { result } = renderHook(() =>
      usePublishConfigListModel(
        params({
          profiles: [profile("p-1"), profile("p-2")],
          projectPublishProfiles: ["Release", "Debug"],
          recentConfigKeys: ["pubxml:Release", "pubxml:Debug"],
          showReorderControls: true,
        })
      )
    );

    expect(result.current.recentDragEnabled).toBe(true);
    expect(result.current.projectProfileDragEnabled).toBe(true);
    expect(result.current.customProfileDragEnabled).toBe(true);
  });

  it("shows custom-profile loading only outside the project filter when empty", () => {
    const { result, rerender } = renderHook(
      (props) => usePublishConfigListModel(props),
      {
        initialProps: params({
          isProfilesRefreshing: true,
          groupFilterValue: ALL_GROUP_FILTER,
        }),
      }
    );
    expect(result.current.shouldShowCustomProfilesLoadingState).toBe(true);

    rerender(
      params({
        isProfilesRefreshing: true,
        groupFilterValue: "__project_profiles__",
      })
    );
    expect(result.current.shouldShowCustomProfilesLoadingState).toBe(false);
  });

  it("prefers the anchored render id when it still resolves to the selection", () => {
    const selection: PublishSelectionRef = {
      kind: "revision",
      configurationId: "p-1",
    };
    const { result } = renderHook(() =>
      usePublishConfigListModel(
        params({
          profiles: [profile("p-1")],
          selection,
          preferredSelectedRenderAnchor: {
            repoId: "repo-1",
            renderId: "userprofile:p-1",
          },
        })
      )
    );

    expect(result.current.selectedRenderId).toBe("userprofile:p-1");
  });
});

describe("usePublishConfigPreviewModel", () => {
  function previewParams(
    overrides: Partial<Parameters<typeof usePublishConfigPreviewModel>[0]> = {}
  ): Parameters<typeof usePublishConfigPreviewModel>[0] {
    return {
      query: "",
      groupFilterValue: ALL_GROUP_FILTER,
      defaultGroupName: "Default",
      showRecentItems: false,
      previewRecentItems: [],
      previewProjectProfiles: [],
      previewProfiles: [],
      shouldShowProjectProfilesLoadingState: false,
      shouldShowCustomProfilesLoadingState: false,
      ...overrides,
    };
  }

  it("shows the empty state only when nothing is visible or loading", () => {
    const { result, rerender } = renderHook(
      (props) => usePublishConfigPreviewModel(props),
      { initialProps: previewParams() }
    );
    expect(result.current.shouldShowEmptyState).toBe(true);

    rerender(previewParams({ shouldShowCustomProfilesLoadingState: true }));
    expect(result.current.shouldShowEmptyState).toBe(false);

    rerender(previewParams({ previewProfiles: [profile("p-1")] }));
    expect(result.current.shouldShowEmptyState).toBe(false);
  });
});
