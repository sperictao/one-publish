import {
  defaultRepoPublishConfig,
  type PublishConfigStore,
} from "@/lib/store";
import { getPathBasename, joinPath } from "@/lib/paths";
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

export function buildDotnetPublishCommand(
  projectFile: string,
  parameters: Record<string, unknown>
): string {
  const parameterArgs: string[] = [];

  if (typeof parameters.configuration === "string") {
    parameterArgs.push(`-c ${parameters.configuration}`);
  }
  if (typeof parameters.runtime === "string") {
    parameterArgs.push(`--runtime ${parameters.runtime}`);
  }
  if (typeof parameters.framework === "string") {
    parameterArgs.push(`--framework ${parameters.framework}`);
  }
  if (parameters.self_contained === true) {
    parameterArgs.push("--self-contained");
  }
  if (typeof parameters.output === "string") {
    parameterArgs.push(`-o "${parameters.output}"`);
  }
  if (parameters.no_build === true) {
    parameterArgs.push("--no-build");
  }
  if (parameters.no_restore === true) {
    parameterArgs.push("--no-restore");
  }
  if (typeof parameters.verbosity === "string") {
    parameterArgs.push(`--verbosity ${parameters.verbosity}`);
  }
  if (parameters.no_logo === true) {
    parameterArgs.push("--no-logo");
  }
  if (Array.isArray(parameters.define)) {
    for (const define of parameters.define) {
      if (typeof define === "string" && define.trim().length > 0) {
        parameterArgs.push(`--define ${define.trim()}`);
      }
    }
  }
  if (
    parameters.properties &&
    typeof parameters.properties === "object" &&
    !Array.isArray(parameters.properties)
  ) {
    for (const [key, value] of Object.entries(
      parameters.properties as Record<string, unknown>
    )) {
      if (
        (typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean") &&
        key.trim().length > 0
      ) {
        parameterArgs.push(`-p:${key}=${String(value)}`);
      }
    }
  }

  return [`dotnet publish "${projectFile}"`, ...parameterArgs].join(" ");
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
