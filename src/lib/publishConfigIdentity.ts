const PROJECT_PROFILE_SELECTED_PRESET_PREFIX = "profile-";
const RECENT_CONFIG_RENDER_ID_PREFIX = "recent:";

export type PublishConfigKeyKind = "preset" | "pubxml" | "userprofile";
export type PublishConfigKey = `${PublishConfigKeyKind}:${string}`;
export type PublishConfigRenderId =
  | PublishConfigKey
  | `${typeof RECENT_CONFIG_RENDER_ID_PREFIX}${PublishConfigKey}`;

export type PublishConfigIdentity =
  | {
      kind: "preset";
      id: string;
    }
  | {
      kind: "project-profile";
      profileName: string;
    }
  | {
      kind: "user-profile";
      profileName: string;
    };

function normalizeIdentityValue(value: string) {
  return value.trim();
}

function createConfigKey(
  kind: PublishConfigKeyKind,
  value: string
): PublishConfigKey {
  return `${kind}:${normalizeIdentityValue(value)}` as PublishConfigKey;
}

export function createProjectProfileSelectedPreset(profileName: string) {
  return `${PROJECT_PROFILE_SELECTED_PRESET_PREFIX}${normalizeIdentityValue(
    profileName
  )}`;
}

export function getSelectedProjectProfileName(selectedPreset: string) {
  if (!selectedPreset.startsWith(PROJECT_PROFILE_SELECTED_PRESET_PREFIX)) {
    return null;
  }

  const profileName = normalizeIdentityValue(
    selectedPreset.slice(PROJECT_PROFILE_SELECTED_PRESET_PREFIX.length)
  );
  return profileName || null;
}

export function createPresetConfigKey(presetId: string) {
  return createConfigKey("preset", presetId);
}

export function createProjectProfileConfigKey(profileName: string) {
  return createConfigKey("pubxml", profileName);
}

export function createUserProfileConfigKey(profileName: string) {
  return createConfigKey("userprofile", profileName);
}

export function parsePublishConfigKey(
  configKey: string
): PublishConfigIdentity | null {
  const separatorIndex = configKey.indexOf(":");
  if (separatorIndex <= 0) {
    return null;
  }

  const keyKind = configKey.slice(0, separatorIndex);
  const keyValue = normalizeIdentityValue(configKey.slice(separatorIndex + 1));
  if (!keyValue) {
    return null;
  }

  if (keyKind === "preset") {
    return {
      kind: "preset",
      id: keyValue,
    };
  }

  if (keyKind === "pubxml") {
    return {
      kind: "project-profile",
      profileName: keyValue,
    };
  }

  if (keyKind === "userprofile") {
    return {
      kind: "user-profile",
      profileName: keyValue,
    };
  }

  return null;
}

export function getProjectProfileNameFromConfigKey(configKey: string) {
  const identity = parsePublishConfigKey(configKey);
  return identity?.kind === "project-profile" ? identity.profileName : null;
}

export function getUserProfileNameFromConfigKey(configKey: string) {
  const identity = parsePublishConfigKey(configKey);
  return identity?.kind === "user-profile" ? identity.profileName : null;
}

export function createRecentConfigRenderId(
  configKey: string
): PublishConfigRenderId {
  return `${RECENT_CONFIG_RENDER_ID_PREFIX}${configKey}` as PublishConfigRenderId;
}

export function getRecentConfigKeyFromRenderId(renderId: string | null) {
  if (!renderId?.startsWith(RECENT_CONFIG_RENDER_ID_PREFIX)) {
    return null;
  }

  const configKey = renderId.slice(RECENT_CONFIG_RENDER_ID_PREFIX.length);
  return parsePublishConfigKey(configKey) ? configKey : null;
}

export function normalizeRenderableConfigId(configId: string | null) {
  if (!configId) {
    return null;
  }

  return getRecentConfigKeyFromRenderId(configId) ?? configId;
}

export function getProjectProfileNameFromRenderId(renderId: string | null) {
  if (!renderId) {
    return null;
  }

  return getProjectProfileNameFromConfigKey(renderId);
}

export function getUserProfileNameFromRenderId(renderId: string | null) {
  if (!renderId) {
    return null;
  }

  return getUserProfileNameFromConfigKey(renderId);
}

export function resolveDotnetRecentConfigKeyForSelection(params: {
  activeProviderId: string;
  isCustomMode: boolean;
  activeProfileName: string | null;
  selectedPreset: string;
}) {
  if (params.activeProviderId !== "dotnet") {
    return null;
  }

  if (params.isCustomMode) {
    return params.activeProfileName
      ? createUserProfileConfigKey(params.activeProfileName)
      : null;
  }

  const projectProfileName = getSelectedProjectProfileName(
    params.selectedPreset
  );
  if (projectProfileName) {
    return createProjectProfileConfigKey(projectProfileName);
  }

  return createPresetConfigKey(params.selectedPreset);
}

export function resolveSelectedPublishConfigKey(params: {
  isCustomMode: boolean;
  activeProfileName: string | null;
  selectedPreset: string;
  hasProjectProfile?: (profileName: string) => boolean;
}) {
  if (params.isCustomMode && params.activeProfileName) {
    return createUserProfileConfigKey(params.activeProfileName);
  }

  if (!params.isCustomMode) {
    const projectProfileName = getSelectedProjectProfileName(
      params.selectedPreset
    );
    if (
      projectProfileName &&
      (!params.hasProjectProfile || params.hasProjectProfile(projectProfileName))
    ) {
      return createProjectProfileConfigKey(projectProfileName);
    }
  }

  return null;
}
