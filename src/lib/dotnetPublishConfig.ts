import {
  defaultRepoPublishConfig,
  type PublishConfigStore,
} from "@/lib/store";
import type { ParameterValue } from "@/types/parameters";

export const DOTNET_ADVANCED_PARAMETER_KEYS = [
  "framework",
  "no_build",
  "no_restore",
  "verbosity",
  "no_logo",
  "properties",
  "define",
] as const;

function clonePublishConfigStore(
  config: PublishConfigStore
): PublishConfigStore {
  return {
    ...config,
    properties: { ...config.properties },
    define: [...config.define],
  };
}

export function createDefaultDotnetPublishConfig(): PublishConfigStore {
  return clonePublishConfigStore(defaultRepoPublishConfig.customConfig);
}

export function normalizeDotnetPropertyMap(
  value: unknown
): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, itemValue]) => {
      if (
        typeof itemValue === "string" ||
        typeof itemValue === "number" ||
        typeof itemValue === "boolean"
      ) {
        return [key.trim(), String(itemValue)] as const;
      }

      return null;
    })
    .filter(
      (entry): entry is readonly [string, string] =>
        entry !== null && entry[0].length > 0
    );

  return Object.fromEntries(entries);
}

export function normalizeDotnetStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (
        typeof item === "string" ||
        typeof item === "number" ||
        typeof item === "boolean"
      ) {
        return String(item).trim();
      }
      return "";
    })
    .filter((item) => item.length > 0);
}

export function buildDotnetAdvancedParameters(
  config: PublishConfigStore
): Record<string, ParameterValue> {
  return {
    framework: config.framework,
    no_build: config.noBuild,
    no_restore: config.noRestore,
    verbosity: config.verbosity,
    no_logo: config.noLogo,
    properties: { ...config.properties },
    define: [...config.define],
  };
}

export function createDotnetPublishConfigPatchFromParameter(
  key: string,
  value: ParameterValue
): Partial<PublishConfigStore> | null {
  switch (key) {
    case "configuration":
      return { configuration: typeof value === "string" ? value : "Release" };
    case "runtime":
      return { runtime: typeof value === "string" ? value : "" };
    case "framework":
      return { framework: typeof value === "string" ? value : "" };
    case "output":
      return { outputDir: typeof value === "string" ? value : "" };
    case "self_contained":
      return { selfContained: value === true };
    case "no_build":
      return { noBuild: value === true };
    case "no_restore":
      return { noRestore: value === true };
    case "verbosity":
      return { verbosity: typeof value === "string" ? value : "" };
    case "no_logo":
      return { noLogo: value === true };
    case "properties":
      return { properties: normalizeDotnetPropertyMap(value) };
    case "define":
      return { define: normalizeDotnetStringArray(value) };
    default:
      return null;
  }
}

export function buildDotnetProfileParameters(
  config: PublishConfigStore
): Record<string, ParameterValue> {
  const parameters: Record<string, ParameterValue> = {};

  if (!config.useProfile || config.configuration.trim() !== "Release") {
    parameters.configuration = config.configuration || "Release";
  }

  if (config.runtime.trim()) {
    parameters.runtime = config.runtime.trim();
  }

  if (config.framework.trim()) {
    parameters.framework = config.framework.trim();
  }

  if (config.selfContained) {
    parameters.self_contained = true;
  }

  if (config.outputDir.trim()) {
    parameters.output = config.outputDir.trim();
  }

  if (config.noBuild) {
    parameters.no_build = true;
  }

  if (config.noRestore) {
    parameters.no_restore = true;
  }

  if (config.verbosity.trim()) {
    parameters.verbosity = config.verbosity.trim();
  }

  if (config.noLogo) {
    parameters.no_logo = true;
  }

  const properties = normalizeDotnetPropertyMap(config.properties);
  if (config.useProfile && config.profileName.trim()) {
    properties.PublishProfile = config.profileName.trim();
  }
  if (Object.keys(properties).length > 0) {
    parameters.properties = properties;
  }

  const define = normalizeDotnetStringArray(config.define);
  if (define.length > 0) {
    parameters.define = define;
  }

  return parameters;
}

export function createDotnetPublishConfigFromParameters(
  parameters: Record<string, unknown>,
  options?: { inferProfileSelection?: boolean }
): PublishConfigStore {
  const defaults = createDefaultDotnetPublishConfig();
  const properties = normalizeDotnetPropertyMap(parameters.properties);
  const publishProfile = properties.PublishProfile?.trim() || "";

  return {
    ...defaults,
    configuration:
      typeof parameters.configuration === "string" &&
      parameters.configuration.trim().length > 0
        ? parameters.configuration
        : defaults.configuration,
    runtime:
      typeof parameters.runtime === "string" ? parameters.runtime : defaults.runtime,
    framework:
      typeof parameters.framework === "string"
        ? parameters.framework
        : defaults.framework,
    selfContained: parameters.self_contained === true,
    outputDir:
      typeof parameters.output === "string" ? parameters.output : defaults.outputDir,
    noBuild: parameters.no_build === true,
    noRestore: parameters.no_restore === true,
    verbosity:
      typeof parameters.verbosity === "string"
        ? parameters.verbosity
        : defaults.verbosity,
    noLogo: parameters.no_logo === true,
    properties,
    define: normalizeDotnetStringArray(parameters.define),
    useProfile: options?.inferProfileSelection === true && publishProfile.length > 0,
    profileName:
      options?.inferProfileSelection === true ? publishProfile : defaults.profileName,
  };
}
