import type { ConfigProfile } from "@/lib/store/types";

export interface ProfileListSnapshot {
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
      [profile.name, profile.providerId, profile.profileGroup || ""].join("\u0000")
    )
    .join("\u0001");
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
}

export function buildCopiedProfileName(
  sourceProfileName: string,
  existingNames: Set<string>
): string {
  const normalizedSourceName = sourceProfileName.trim() || "Profile";
  const baseName = `${normalizedSourceName}-copy`;

  if (!existingNames.has(baseName)) {
    return baseName;
  }

  let index = 2;
  while (existingNames.has(`${baseName}${index}`)) {
    index += 1;
  }

  return `${baseName}${index}`;
}
