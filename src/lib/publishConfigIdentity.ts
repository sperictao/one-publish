// Barrel re-export — the canonical config identity module lives in features/config.
// This file satisfies the spec convention that lib/publishConfigIdentity is the
// single entry point for publish config identity encode/decode/normalize.
export {
  type PublishConfigIdentity,
  type PublishConfigKey,
  type PublishConfigKeyKind,
  type PublishConfigRenderId,
  createPresetConfigKey,
  createProjectProfileConfigKey,
  createProjectProfileSelectedPreset,
  createRecentConfigRenderId,
  createUserProfileConfigKey,
  getProjectProfileNameFromConfigKey,
  getProjectProfileNameFromRenderId,
  getRecentConfigKeyFromRenderId,
  getSelectedProjectProfileName,
  getUserProfileNameFromConfigKey,
  getUserProfileNameFromRenderId,
  normalizeRenderableConfigId,
  parsePublishConfigKey,
  resolveDotnetRecentConfigKeyForSelection,
  resolveSelectedPublishConfigKey,
} from "@/features/config/publishConfigIdentity";
