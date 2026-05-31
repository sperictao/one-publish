import { describe, expect, it } from "vitest";
import type { ConfigProfile } from "@/lib/store/types";
import {
  applyStoredOrder,
  projectDraggedItemPosition,
  reorderItemsByDrop,
  reorderProfilesByDrop,
  resolveDropTargetByDraggedCenter,
} from "@/lib/listOrdering";

function createProfile(name: string, profileGroup?: string): ConfigProfile {
  return {
    name,
    providerId: "dotnet",
    parameters: {},
    profileGroup,
    createdAt: "2026-04-03T00:00:00.000Z",
    isSystemDefault: false,
  };
}

describe("listOrdering", () => {
  it("会按持久化顺序排序并把新增项追加到末尾", () => {
    expect(
      applyStoredOrder(["FolderProfile", "ZipProfile", "SingleFile"], [
        "ZipProfile",
        "FolderProfile",
      ])
    ).toEqual(["ZipProfile", "FolderProfile", "SingleFile"]);
  });

  it("支持按落点重新排序简单列表", () => {
    expect(
      reorderItemsByDrop(
        ["alpha", "beta", "gamma"],
        (item) => item,
        "gamma",
        "beta",
        "before"
      )
    ).toEqual(["alpha", "gamma", "beta"]);
  });

  it("拖拽锚点不同但位移相同时，投影出的被拖项中心保持一致", () => {
    const topAnchorProjection = projectDraggedItemPosition({
      pointerX: 28,
      pointerY: 190,
      anchorOffsetX: 8,
      anchorOffsetY: 10,
      itemWidth: 240,
      itemHeight: 40,
    });
    const bottomAnchorProjection = projectDraggedItemPosition({
      pointerX: 28,
      pointerY: 210,
      anchorOffsetX: 8,
      anchorOffsetY: 30,
      itemWidth: 240,
      itemHeight: 40,
    });

    expect(topAnchorProjection.top).toBe(180);
    expect(bottomAnchorProjection.top).toBe(180);
    expect(topAnchorProjection.centerY).toBe(200);
    expect(bottomAnchorProjection.centerY).toBe(200);
  });

  it("只有在被拖项中心越过相邻项中线后才会触发自动冒泡", () => {
    const geometries = [
      { itemId: "alpha", top: 0, height: 40, meta: undefined },
      { itemId: "beta", top: 40, height: 40, meta: undefined },
      { itemId: "gamma", top: 80, height: 40, meta: undefined },
    ];

    expect(
      resolveDropTargetByDraggedCenter({
        activeItemId: "gamma",
        activeCenterY: 61,
        items: geometries,
      })
    ).toEqual({
      itemId: "beta",
      position: "after",
      meta: undefined,
    });

    expect(
      resolveDropTargetByDraggedCenter({
        activeItemId: "gamma",
        activeCenterY: 59,
        items: geometries,
      })
    ).toEqual({
      itemId: "beta",
      position: "before",
      meta: undefined,
    });
  });

  it("支持把配置跨组移动并更新目标分组", () => {
    const nextProfiles = reorderProfilesByDrop({
      profiles: [
        createProfile("alpha", "Group A"),
        createProfile("beta", "Group B"),
        createProfile("gamma", "Group B"),
      ],
      activeProfileName: "alpha",
      targetProfileName: "gamma",
      targetGroupKey: "Group B",
      position: "before",
      defaultGroupName: "默认分组",
    });

    expect(
      nextProfiles.map((profile) => ({
        name: profile.name,
        profileGroup: profile.profileGroup,
      }))
    ).toEqual([
      { name: "beta", profileGroup: "Group B" },
      { name: "alpha", profileGroup: "Group B" },
      { name: "gamma", profileGroup: "Group B" },
    ]);
  });
});
