import {
  defaultRepoPublishConfig,
  type PublishConfigStore,
} from "@/lib/store/types";
import { getPathBasename, joinPath } from "@/lib/paths";
import type { ParameterValue } from "@/types/parameters";

export const DOTNET_ADVANCED_PARAMETER_KEYS = [
  "framework",
  "no_build",
  "no_restore",
  "verbosity",
  "no_logo",
  "delete_existing_files",
  "properties",
] as const;

const DOTNET_UNSUPPORTED_PUBLISH_PROPERTY_KEYS = [
  "Configuration",
  "Define",
  "ExcludeApp_Data",
  "LastUsedBuildConfiguration",
  "LastUsedPlatform",
  "LaunchSiteAfterPublish",
  "Platform",
  "ProjectGuid",
  "PublishProvider",
  "PublishUrl",
  "RuntimeIdentifier",
  "RuntimeIdentifiers",
  "SiteUrlToLaunchAfterPublish",
  "TargetFramework",
  "TargetFrameworks",
  "WebPublishMethod",
  "_TargetId",
] as const;

const DOTNET_UNSUPPORTED_PUBLISH_PROPERTY_KEY_SET = new Set(
  DOTNET_UNSUPPORTED_PUBLISH_PROPERTY_KEYS.map((key) => key.toLowerCase())
);

function clonePublishConfigStore(
  config: PublishConfigStore
): PublishConfigStore {
  return {
    ...config,
    properties: { ...config.properties },
  };
}

export function createDefaultDotnetPublishConfig(): PublishConfigStore {
  return clonePublishConfigStore(defaultRepoPublishConfig.customConfig);
}

function stripFileExtension(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

function buildDefaultScopedOutputDir(params: {
  defaultOutputDir?: string;
  projectFile?: string;
  projectRoot?: string;
  configuration?: string;
}): string {
  const { defaultOutputDir, projectFile, projectRoot, configuration } = params;
  if (!defaultOutputDir) {
    return "";
  }

  const projectName = projectFile
    ? stripFileExtension(getPathBasename(projectFile))
    : projectRoot
      ? getPathBasename(projectRoot)
      : "";
  const resolvedConfiguration = configuration?.trim() || "Release";

  return projectName
    ? joinPath(defaultOutputDir, projectName, resolvedConfiguration)
    : joinPath(defaultOutputDir, resolvedConfiguration);
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

export function sanitizeDotnetPublishProperties(
  properties: Record<string, string>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(properties).filter(
      ([key]) =>
        !DOTNET_UNSUPPORTED_PUBLISH_PROPERTY_KEY_SET.has(key.toLowerCase())
    )
  );
}

function parseBooleanString(value: string | undefined): boolean | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }

  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }

  return null;
}

export function normalizeDeleteExistingFilesProperty(
  properties: Record<string, string>
): {
  deleteExistingFiles: boolean | null;
  properties: Record<string, string>;
} {
  const rawDeleteExistingFiles =
    properties.DeleteExistingFiles ?? properties.deleteExistingFiles;

  if (typeof rawDeleteExistingFiles !== "string") {
    return { deleteExistingFiles: null, properties };
  }

  const parsed = parseBooleanString(rawDeleteExistingFiles);
  if (parsed === null) {
    return { deleteExistingFiles: null, properties };
  }

  const nextProperties = { ...properties };
  delete nextProperties.DeleteExistingFiles;
  delete nextProperties.deleteExistingFiles;

  return { deleteExistingFiles: parsed, properties: nextProperties };
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
    delete_existing_files: config.deleteExistingFiles,
    properties: sanitizeDotnetPublishProperties(
      normalizeDotnetPropertyMap(config.properties)
    ),
  };
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

  if (config.deleteExistingFiles) {
    parameters.delete_existing_files = true;
  }

  const properties = sanitizeDotnetPublishProperties(
    normalizeDotnetPropertyMap(config.properties)
  );
  if (config.useProfile && config.profileName.trim()) {
    properties.PublishProfile = config.profileName.trim();
  }
  if (Object.keys(properties).length > 0) {
    parameters.properties = properties;
  }

  return parameters;
}

export function normalizeDotnetProjectBoundParameters(params: {
  parameters: Record<string, unknown>;
  defaultOutputDir?: string;
  projectFile?: string;
  projectRoot?: string;
}): Record<string, ParameterValue> {
  const config = createDotnetPublishConfigFromParameters(params.parameters);

  if (!config.outputDir.trim() && params.defaultOutputDir) {
    config.outputDir = buildDefaultScopedOutputDir({
      defaultOutputDir: params.defaultOutputDir,
      projectFile: params.projectFile,
      projectRoot: params.projectRoot,
      configuration: config.configuration,
    });
  }

  return buildDotnetProfileParameters(config);
}

export function createDotnetPublishConfigFromParameters(
  parameters: Record<string, unknown>,
  options?: { inferProfileSelection?: boolean }
): PublishConfigStore {
  const defaults = createDefaultDotnetPublishConfig();
  const normalizedProperties = normalizeDotnetPropertyMap(parameters.properties);
  const {
    deleteExistingFiles,
    properties: deleteExistingFilesNormalizedProperties,
  } = normalizeDeleteExistingFilesProperty(normalizedProperties);
  const properties = sanitizeDotnetPublishProperties(
    deleteExistingFilesNormalizedProperties
  );
  const resolvedDeleteExistingFiles =
    typeof parameters.delete_existing_files === "boolean"
      ? parameters.delete_existing_files
      : deleteExistingFiles === true;
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
    deleteExistingFiles: resolvedDeleteExistingFiles,
    properties,
    useProfile: options?.inferProfileSelection === true && publishProfile.length > 0,
    profileName:
      options?.inferProfileSelection === true ? publishProfile : defaults.profileName,
  };
}
