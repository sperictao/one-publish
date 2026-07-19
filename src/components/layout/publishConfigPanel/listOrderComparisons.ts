import type { ConfigProfile } from "@/lib/store/types";

export function hasSameStringOrder(
  left: readonly string[],
  right: readonly string[]
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export function hasSameProfileOrder(
  left: readonly ConfigProfile[],
  right: readonly ConfigProfile[]
): boolean {
  return (
    left.length === right.length &&
    left.every((profile, index) => {
      const nextProfile = right[index];
      return (
        profile.name === nextProfile.name &&
        (profile.profileGroup || "") === (nextProfile.profileGroup || "")
      );
    })
  );
}
