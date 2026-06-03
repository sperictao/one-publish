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

export type PublishSelectionIdentity =
  | {
      kind: "provider";
      providerId: string;
    }
  | {
      kind: "custom";
    }
  | {
      kind: "preset";
      presetId: string;
      configKey: PublishConfigKey;
    }
  | {
      kind: "project-profile";
      profileName: string;
      configKey: PublishConfigKey;
    }
  | {
      kind: "user-profile";
      profileName: string;
      configKey: PublishConfigKey;
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

export function resolvePublishSelectionIdentity(params: {
  activeProviderId: string;
  isCustomMode: boolean;
  selectedPreset: string;
}): PublishSelectionIdentity {
  if (params.activeProviderId !== "dotnet") {
    return {
      kind: "provider",
      providerId: params.activeProviderId,
    };
  }

  if (params.isCustomMode) {
    const selectedConfig = parsePublishConfigKey(params.selectedPreset);
    if (selectedConfig?.kind === "user-profile") {
      return {
        kind: "user-profile",
        profileName: selectedConfig.profileName,
        configKey: createUserProfileConfigKey(selectedConfig.profileName),
      };
    }

    return {
      kind: "custom",
    };
  }

  const projectProfileName = getSelectedProjectProfileName(
    params.selectedPreset
  );
  if (projectProfileName) {
    return {
      kind: "project-profile",
      profileName: projectProfileName,
      configKey: createProjectProfileConfigKey(projectProfileName),
    };
  }

  const presetId = normalizeIdentityValue(params.selectedPreset);
  return {
    kind: "preset",
    presetId,
    configKey: createPresetConfigKey(presetId),
  };
}

export function getActiveProfileNameFromSelection(
  identity: PublishSelectionIdentity
) {
  return identity.kind === "user-profile" ? identity.profileName : null;
}

export function getProjectProfileNameFromSelection(
  identity: PublishSelectionIdentity
) {
  return identity.kind === "project-profile" ? identity.profileName : null;
}

export function getRecentConfigKeyFromSelection(
  identity: PublishSelectionIdentity
) {
  return "configKey" in identity ? identity.configKey : null;
}

export function resolveSelectedPublishConfigKeyFromIdentity(
  identity: PublishSelectionIdentity,
  params: {
    hasProjectProfile?: (profileName: string) => boolean;
  } = {}
) {
  if (identity.kind === "user-profile") {
    return identity.configKey;
  }

  if (
    identity.kind === "project-profile" &&
    (!params.hasProjectProfile || params.hasProjectProfile(identity.profileName))
  ) {
    return identity.configKey;
  }

  return null;
}

export function resolveDotnetRecentConfigKeyForSelection(params: {
  activeProviderId: string;
  isCustomMode: boolean;
  activeProfileName: string | null;
  selectedPreset: string;
}) {
  return getRecentConfigKeyFromSelection(
    resolvePublishSelectionIdentity({
      activeProviderId: params.activeProviderId,
      isCustomMode: params.isCustomMode,
      selectedPreset: params.selectedPreset,
    })
  );
}

export function resolveSelectedPublishConfigKey(params: {
  isCustomMode: boolean;
  activeProfileName: string | null;
  selectedPreset: string;
  hasProjectProfile?: (profileName: string) => boolean;
}) {
  return resolveSelectedPublishConfigKeyFromIdentity(
    resolvePublishSelectionIdentity({
      activeProviderId: "dotnet",
      isCustomMode: params.isCustomMode,
      selectedPreset: params.selectedPreset,
    }),
    {
      hasProjectProfile: params.hasProjectProfile,
    }
  );
}
