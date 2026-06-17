import type { ConfigProfile } from "@/lib/store/types";

export interface ProfileListSnapshot {
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
      [profile.name, profile.providerId, profile.profileGroup || ""].join("\u0000")
    )
    .join("\u0001");
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
