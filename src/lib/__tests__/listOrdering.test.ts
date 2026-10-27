import { describe, expect, it } from "vitest";
import type { ConfigProfile } from "@/lib/store/types";
import {
  applyStoredOrder,
  buildProfileGroups,
  projectDraggedItemPosition,
  reorderItemsByDrop,
  reorderProfilesByDrop,
  resolveDropTargetByDraggedCenter,
} from "@/lib/listOrdering";

function createProfile(name: string, profileGroup?: string): ConfigProfile {
  return {
    id: name,
    revisionId: `${name}-revision`,
    name,
    providerId: "dotnet",
    parameters: {},
    profileGroup,
    createdAt: "2026-04-03T00:00:00.000Z",
    isSystemDefault: false,
    externalBindingIds: [],
  };
}

describe("listOrdering", () => {
  it("会按持久化顺序排序并把新增项追加到末尾", () => {
    expect(
      applyStoredOrder(
        ["FolderProfile", "ZipProfile", "SingleFile"],
        ["ZipProfile", "FolderProfile"]
      )
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
      activeProfileId: "alpha",
      targetProfileId: "gamma",
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

  it("applyStoredOrder 跳过未知与重复 id", () => {
    expect(applyStoredOrder(["a", "b"], ["ghost", "a", "a", "b"])).toEqual([
      "a",
      "b",
    ]);
  });

  it("reorderItemsByDrop 对同 id、缺失源与缺失目标均保持原序", () => {
    const items = ["alpha", "beta", "gamma"];
    const getId = (item: string) => item;

    // activeId === targetId → 原样返回
    expect(reorderItemsByDrop(items, getId, "beta", "beta", "before")).toEqual(
      items
    );

    // 源项不存在 → 原样返回
    expect(reorderItemsByDrop(items, getId, "ghost", "beta", "before")).toEqual(
      items
    );

    // 目标项不存在 → 源项回归原位、顺序不变
    expect(reorderItemsByDrop(items, getId, "beta", "ghost", "before")).toEqual(
      items
    );
  });

  it("reorderItemsByDrop 的 after 落点插到目标项之后", () => {
    expect(
      reorderItemsByDrop(
        ["alpha", "beta", "gamma"],
        (item) => item,
        "alpha",
        "gamma",
        "after"
      )
    ).toEqual(["beta", "gamma", "alpha"]);
  });

  it("resolveDropTargetByDraggedCenter 在排除自身后无候选时返回 null", () => {
    expect(
      resolveDropTargetByDraggedCenter({
        activeItemId: "only",
        activeCenterY: 10,
        items: [{ itemId: "only", top: 0, height: 40, meta: null }],
      })
    ).toBeNull();
  });

  it("buildProfileGroups 把缺省组排最前并按组名排序其余组", () => {
    const built = buildProfileGroups(
      [
        createProfile("u"),
        createProfile("b", "Beta"),
        createProfile("a", "Alpha"),
        createProfile("ws", "   "),
      ],
      "默认分组"
    );

    // 空白组名归一化为缺省组并前置；其余组按 groupName locale 排序。
    expect(built.map((group) => group.groupKey)).toEqual(["", "Alpha", "Beta"]);
    expect(built[0]?.groupName).toBe("默认分组");
    expect(built[0]?.items.map((profile) => profile.id)).toEqual(["u", "ws"]);
  });

  it("reorderProfilesByDrop 对同 id、缺失源、缺失组与缺失目标均保持原序", () => {
    const profiles = [createProfile("alpha"), createProfile("beta", "Group B")];

    // activeId === targetId → 原样
    expect(
      reorderProfilesByDrop({
        profiles,
        activeProfileId: "alpha",
        targetProfileId: "alpha",
        targetGroupKey: "",
        position: "before",
        defaultGroupName: "默认分组",
      }).map((p) => p.id)
    ).toEqual(["alpha", "beta"]);

    // 源 profile 不在列表 → 原样
    expect(
      reorderProfilesByDrop({
        profiles,
        activeProfileId: "ghost",
        targetProfileId: "beta",
        targetGroupKey: "Group B",
        position: "before",
        defaultGroupName: "默认分组",
      }).map((p) => p.id)
    ).toEqual(["alpha", "beta"]);

    // 目标分组不存在 → 原样
    expect(
      reorderProfilesByDrop({
        profiles,
        activeProfileId: "alpha",
        targetProfileId: "beta",
        targetGroupKey: "Ghost Group",
        position: "before",
        defaultGroupName: "默认分组",
      }).map((p) => p.id)
    ).toEqual(["alpha", "beta"]);

    // 目标 profile 不在目标分组 → 原样
    expect(
      reorderProfilesByDrop({
        profiles,
        activeProfileId: "alpha",
        targetProfileId: "ghost",
        targetGroupKey: "Group B",
        position: "before",
        defaultGroupName: "默认分组",
      }).map((p) => p.id)
    ).toEqual(["alpha", "beta"]);
  });

  it("reorderProfilesByDrop 的 after 落点插到目标之后并把空组键写为 undefined", () => {
    const profiles = [createProfile("alpha", "Group A"), createProfile("beta")];

    const next = reorderProfilesByDrop({
      profiles,
      activeProfileId: "alpha",
      targetProfileId: "beta",
      targetGroupKey: "",
      position: "after",
      defaultGroupName: "默认分组",
    });

    expect(next.map((p) => p.id)).toEqual(["beta", "alpha"]);
    // 移入缺省组时 profileGroup 清空（目标组键为空 → undefined）。
    expect(next[1]?.profileGroup).toBeUndefined();
  });
});
