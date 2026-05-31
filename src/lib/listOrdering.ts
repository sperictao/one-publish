import type { ConfigProfile } from "@/lib/store/types";

export type DropPosition = "before" | "after";

export interface ListDropTarget<TMeta> {
  itemId: string;
  position: DropPosition;
  meta: TMeta;
}

export interface SortableItemGeometry<TMeta> {
  itemId: string;
  top: number;
  height: number;
  meta: TMeta;
}

export interface DraggedItemProjection {
  left: number;
  top: number;
  centerX: number;
  centerY: number;
}

export interface ProfileGroupBucket {
  groupKey: string;
  groupName: string;
  items: ConfigProfile[];
}

export function projectDraggedItemPosition(params: {
  pointerX: number;
  pointerY: number;
  anchorOffsetX: number;
  anchorOffsetY: number;
  itemWidth: number;
  itemHeight: number;
}): DraggedItemProjection {
  const {
    pointerX,
    pointerY,
    anchorOffsetX,
    anchorOffsetY,
    itemWidth,
    itemHeight,
  } = params;
  const left = pointerX - anchorOffsetX;
  const top = pointerY - anchorOffsetY;

  return {
    left,
    top,
    centerX: left + itemWidth / 2,
    centerY: top + itemHeight / 2,
  };
}

export function resolveDropTargetByDraggedCenter<TMeta>(params: {
  activeItemId: string;
  activeCenterY: number;
  items: readonly SortableItemGeometry<TMeta>[];
}): ListDropTarget<TMeta> | null {
  const { activeItemId, activeCenterY, items } = params;
  const orderedItems = items
    .filter((item) => item.itemId !== activeItemId)
    .sort((left, right) => left.top - right.top);

  if (orderedItems.length === 0) {
    return null;
  }

  for (const item of orderedItems) {
    const midpointY = item.top + item.height / 2;
    if (activeCenterY < midpointY) {
      return {
        itemId: item.itemId,
        position: "before",
        meta: item.meta,
      };
    }
  }

  const lastItem = orderedItems[orderedItems.length - 1];
  return {
    itemId: lastItem.itemId,
    position: "after",
    meta: lastItem.meta,
  };
}

export function applyStoredOrder(
  items: string[],
  orderedIds: readonly string[]
): string[] {
  const itemSet = new Set(items);
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const id of orderedIds) {
    if (!itemSet.has(id) || seen.has(id)) {
      continue;
    }

    ordered.push(id);
    seen.add(id);
  }

  for (const id of items) {
    if (seen.has(id)) {
      continue;
    }

    ordered.push(id);
    seen.add(id);
  }

  return ordered;
}

export function reorderItemsByDrop<T>(
  items: readonly T[],
  getId: (item: T) => string,
  activeId: string,
  targetId: string,
  position: DropPosition
): T[] {
  if (activeId === targetId) {
    return [...items];
  }

  const nextItems = [...items];
  const sourceIndex = nextItems.findIndex((item) => getId(item) === activeId);

  if (sourceIndex === -1) {
    return nextItems;
  }

  const [activeItem] = nextItems.splice(sourceIndex, 1);
  const targetIndex = nextItems.findIndex((item) => getId(item) === targetId);

  if (targetIndex === -1) {
    nextItems.splice(sourceIndex, 0, activeItem);
    return nextItems;
  }

  const insertIndex = position === "after" ? targetIndex + 1 : targetIndex;
  nextItems.splice(insertIndex, 0, activeItem);
  return nextItems;
}

export function normalizeProfileGroupKey(
  value?: string | null
): string {
  return value?.trim() || "";
}

export function buildProfileGroups(
  profiles: readonly ConfigProfile[],
  defaultGroupName: string
): ProfileGroupBucket[] {
  const groupMap = new Map<string, ConfigProfile[]>();

  for (const profile of profiles) {
    const groupKey = normalizeProfileGroupKey(profile.profileGroup);
    const group = groupMap.get(groupKey);

    if (group) {
      group.push(profile);
      continue;
    }

    groupMap.set(groupKey, [profile]);
  }

  return Array.from(groupMap.entries())
    .map(([groupKey, items]) => ({
      groupKey,
      groupName: groupKey || defaultGroupName,
      items,
    }))
    .sort((left, right) => {
      if (!left.groupKey) {
        return -1;
      }
      if (!right.groupKey) {
        return 1;
      }

      return left.groupName.localeCompare(right.groupName);
    });
}

export function reorderProfilesByDrop(params: {
  profiles: readonly ConfigProfile[];
  activeProfileName: string;
  targetProfileName: string;
  targetGroupKey: string;
  position: DropPosition;
  defaultGroupName: string;
}): ConfigProfile[] {
  const {
    profiles,
    activeProfileName,
    targetProfileName,
    targetGroupKey,
    position,
    defaultGroupName,
  } = params;

  if (activeProfileName === targetProfileName) {
    return [...profiles];
  }

  const groups = buildProfileGroups(profiles, defaultGroupName).map((group) => ({
    ...group,
    items: [...group.items],
  }));

  let activeProfile: ConfigProfile | null = null;

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
  }

  const targetGroup = groups.find((group) => group.groupKey === targetGroupKey);
  if (!targetGroup) {
    return [...profiles];
  }

  const targetIndex = targetGroup.items.findIndex(
    (profile) => profile.name === targetProfileName
  );
  if (targetIndex === -1) {
    return [...profiles];
  }

  const nextProfile: ConfigProfile = {
    ...activeProfile,
    profileGroup: targetGroupKey || undefined,
  };

  const insertIndex = position === "after" ? targetIndex + 1 : targetIndex;
  targetGroup.items.splice(insertIndex, 0, nextProfile);

  return groups.flatMap((group) => group.items);
}
