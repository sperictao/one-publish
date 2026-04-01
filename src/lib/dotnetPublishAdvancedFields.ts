import {
  normalizeDotnetPropertyMap,
  normalizeDotnetStringArray,
} from "@/lib/dotnetPublishConfig";
import type { PublishConfigStore } from "@/lib/store";
import type {
  ParameterDefinition,
  ParameterSchema,
  ParameterValue,
} from "@/types/parameters";

const FALLBACK_PROPERTIES_DEFINITION: ParameterDefinition = {
  type: "map",
  flag: "-p:",
  prefix: "-p:",
  description: "MSBuild properties",
};

const FALLBACK_DEFINE_DEFINITION: ParameterDefinition = {
  type: "array",
  flag: "--define",
  description: "Conditional compilation symbols",
};

const FALLBACK_FRAMEWORK_DEFINITION: ParameterDefinition = {
  type: "string",
  flag: "--framework",
  description: "Target framework",
};

const FALLBACK_VERBOSITY_DEFINITION: ParameterDefinition = {
  type: "string",
  flag: "--verbosity",
  description: "Set the MSBuild verbosity level.",
};

const FALLBACK_BOOLEAN_DEFINITION: ParameterDefinition = {
  type: "boolean",
  flag: "",
  description: "",
};

const LAST_USED_BUILD_CONFIGURATION_OPTIONS = [
  { value: "Release", label: "Release" },
  { value: "Debug", label: "Debug" },
] as const;

export const DOTNET_VERBOSITY_OPTIONS = [
  { value: "quiet", label: "quiet" },
  { value: "minimal", label: "minimal" },
  { value: "normal", label: "normal" },
  { value: "detailed", label: "detailed" },
  { value: "diagnostic", label: "diagnostic" },
] as const;

type FixedPropertyFieldConfig = {
  key: string;
  group: "base" | "collapsed";
  control: "boolean" | "string" | "select";
  description: string;
  options?: ReadonlyArray<{ value: string; label: string }>;
};

const FIXED_PROPERTY_FIELD_CONFIGS: ReadonlyArray<FixedPropertyFieldConfig> = [
  {
    key: "DeleteExistingFiles",
    group: "base",
    control: "boolean",
    description:
      "Delete the existing files in the target publish directory before deployment.",
  },
  {
    key: "ExcludeApp_Data",
    group: "base",
    control: "boolean",
    description: "Exclude the App_Data folder from the publish output.",
  },
  {
    key: "LaunchSiteAfterPublish",
    group: "base",
    control: "boolean",
    description: "Launch the published site after deployment completes.",
  },
  {
    key: "LastUsedBuildConfiguration",
    group: "base",
    control: "select",
    description: "Remember the last build configuration used by this profile.",
    options: LAST_USED_BUILD_CONFIGURATION_OPTIONS,
  },
  {
    key: "LastUsedPlatform",
    group: "base",
    control: "string",
    description: "Remember the last build platform used by this profile.",
  },
  {
    key: "PublishProvider",
    group: "base",
    control: "string",
    description: "Publish provider identifier stored in the profile.",
  },
  {
    key: "WebPublishMethod",
    group: "base",
    control: "string",
    description: "Web publish method stored in the profile.",
  },
  {
    key: "SiteUrlToLaunchAfterPublish",
    group: "base",
    control: "string",
    description: "Site URL to open after publish completes.",
  },
  {
    key: "ProjectGuid",
    group: "base",
    control: "string",
    description: "Associated project GUID stored in the publish profile.",
  },
  {
    key: "_TargetId",
    group: "collapsed",
    control: "string",
    description: "Target identifier used by MSBuild publish targets.",
  },
  {
    key: "PublishSingleFile",
    group: "collapsed",
    control: "boolean",
    description: "Bundle the published app into a single-file output.",
  },
] as const;

export const DOTNET_FIXED_PROPERTY_KEYS = FIXED_PROPERTY_FIELD_CONFIGS.map(
  (item) => item.key
);

export type DotnetAdvancedFieldControl =
  | "framework-suggestions"
  | "select"
  | "boolean"
  | "string"
  | "tags"
  | "property-map";

export type DotnetAdvancedFieldSource =
  | {
      kind: "draft";
      draftKey:
        | "framework"
        | "noBuild"
        | "noRestore"
        | "verbosity"
        | "noLogo"
        | "define";
      valueType: "string" | "boolean" | "stringArray";
    }
  | {
      kind: "property";
      propertyKey: string;
      valueType: "string" | "boolean";
    }
  | {
      kind: "properties";
      excludedPropertyKeys: string[];
      valueType: "stringMap";
    };

export interface DotnetAdvancedFieldOption {
  value: string;
  label: string;
}

export interface DotnetAdvancedFieldModel {
  key: string;
  title: string;
  label: string;
  description?: string;
  definition: ParameterDefinition;
  control: DotnetAdvancedFieldControl;
  value: ParameterValue;
  options?: DotnetAdvancedFieldOption[];
  emptyOptionLabel?: string;
  source: DotnetAdvancedFieldSource;
}

export interface DotnetAdvancedFieldsModel {
  allFields: DotnetAdvancedFieldModel[];
  baseFields: DotnetAdvancedFieldModel[];
  collapsedFields: DotnetAdvancedFieldModel[];
  fieldMap: Map<string, DotnetAdvancedFieldModel>;
}

export function parseDotnetBooleanValue(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }

  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }

  return null;
}

export function buildDotnetAdvancedFieldsModel(params: {
  config: PublishConfigStore;
  dotnetSchema?: ParameterSchema;
  projectFrameworkOptions?: string[];
}): DotnetAdvancedFieldsModel {
  const { config, dotnetSchema, projectFrameworkOptions = [] } = params;
  const properties = normalizeDotnetPropertyMap(config.properties);
  const baseFields: DotnetAdvancedFieldModel[] = [];
  const collapsedFields: DotnetAdvancedFieldModel[] = [];

  baseFields.push(
    createFrameworkField(
      dotnetSchema?.parameters.framework || FALLBACK_FRAMEWORK_DEFINITION,
      config.framework,
      projectFrameworkOptions
    )
  );

  for (const propertyField of FIXED_PROPERTY_FIELD_CONFIGS.filter(
    (item) => item.group === "base"
  )) {
    baseFields.push(createFixedPropertyField(propertyField, properties));
  }

  collapsedFields.push(
    createBooleanDraftField(
      "no_build",
      dotnetSchema?.parameters.no_build,
      config.noBuild
    ),
    createBooleanDraftField(
      "no_restore",
      dotnetSchema?.parameters.no_restore,
      config.noRestore
    ),
    createVerbosityField(
      dotnetSchema?.parameters.verbosity || FALLBACK_VERBOSITY_DEFINITION,
      config.verbosity
    ),
    createBooleanDraftField(
      "no_logo",
      dotnetSchema?.parameters.no_logo,
      config.noLogo
    )
  );

  for (const propertyField of FIXED_PROPERTY_FIELD_CONFIGS.filter(
    (item) => item.group === "collapsed"
  )) {
    collapsedFields.push(createFixedPropertyField(propertyField, properties));
  }

  collapsedFields.push(
    createDefineField(
      dotnetSchema?.parameters.define || FALLBACK_DEFINE_DEFINITION,
      config.define
    ),
    createPropertiesField(
      dotnetSchema?.parameters.properties || FALLBACK_PROPERTIES_DEFINITION,
      properties
    )
  );

  const allFields = [...baseFields, ...collapsedFields];

  return {
    allFields,
    baseFields,
    collapsedFields,
    fieldMap: new Map(allFields.map((field) => [field.key, field] as const)),
  };
}

function createFrameworkField(
  definition: ParameterDefinition,
  value: string,
  projectFrameworkOptions: string[]
): DotnetAdvancedFieldModel {
  const options = dedupeStringOptions([...projectFrameworkOptions, value]);

  return {
    key: "framework",
    title: "framework",
    label: definition.flag || "--framework",
    description: definition.description,
    definition,
    control: "framework-suggestions",
    value,
    options,
    source: {
      kind: "draft",
      draftKey: "framework",
      valueType: "string",
    },
  };
}

function createVerbosityField(
  definition: ParameterDefinition,
  value: string
): DotnetAdvancedFieldModel {
  return {
    key: "verbosity",
    title: "verbosity",
    label: definition.flag || "--verbosity",
    description: definition.description,
    definition,
    control: "select",
    value,
    options: [...DOTNET_VERBOSITY_OPTIONS],
    emptyOptionLabel: "未指定",
    source: {
      kind: "draft",
      draftKey: "verbosity",
      valueType: "string",
    },
  };
}

function createBooleanDraftField(
  key: "no_build" | "no_restore" | "no_logo",
  definition: ParameterDefinition | undefined,
  value: boolean
): DotnetAdvancedFieldModel {
  const resolvedDefinition = definition || {
    ...FALLBACK_BOOLEAN_DEFINITION,
    flag:
      key === "no_build"
        ? "--no-build"
        : key === "no_restore"
          ? "--no-restore"
          : "--no-logo",
  };
  const draftKey =
    key === "no_build" ? "noBuild" : key === "no_restore" ? "noRestore" : "noLogo";

  return {
    key,
    title: key,
    label: resolvedDefinition.flag,
    description: resolvedDefinition.description,
    definition: resolvedDefinition,
    control: "boolean",
    value,
    source: {
      kind: "draft",
      draftKey,
      valueType: "boolean",
    },
  };
}

function createDefineField(
  definition: ParameterDefinition,
  value: string[]
): DotnetAdvancedFieldModel {
  return {
    key: "define",
    title: "define",
    label: definition.flag || "--define",
    description: definition.description,
    definition,
    control: "tags",
    value: normalizeDotnetStringArray(value),
    source: {
      kind: "draft",
      draftKey: "define",
      valueType: "stringArray",
    },
  };
}

function createPropertiesField(
  definition: ParameterDefinition,
  properties: Record<string, string>
): DotnetAdvancedFieldModel {
  const remainingProperties = Object.fromEntries(
    Object.entries(properties).filter(
      ([key]) => !DOTNET_FIXED_PROPERTY_KEYS.includes(key)
    )
  );

  return {
    key: "properties",
    title: "properties",
    label: definition.prefix || definition.flag || "-p:",
    description: definition.description,
    definition,
    control: "property-map",
    value: remainingProperties,
    source: {
      kind: "properties",
      excludedPropertyKeys: [...DOTNET_FIXED_PROPERTY_KEYS],
      valueType: "stringMap",
    },
  };
}

function createFixedPropertyField(
  config: FixedPropertyFieldConfig,
  properties: Record<string, string>
): DotnetAdvancedFieldModel {
  const rawValue = properties[config.key] || "";
  const definition = createSyntheticPropertyDefinition(config);

  if (config.control === "boolean") {
    return {
      key: config.key,
      title: config.key,
      label: config.key,
      description: config.description,
      definition,
      control: "boolean",
      value: parseDotnetBooleanValue(rawValue) === true,
      source: {
        kind: "property",
        propertyKey: config.key,
        valueType: "boolean",
      },
    };
  }

  if (config.control === "select") {
    return {
      key: config.key,
      title: config.key,
      label: config.key,
      description: config.description,
      definition,
      control: "select",
      value: rawValue,
      options: config.options ? [...config.options] : [],
      emptyOptionLabel: "未设置",
      source: {
        kind: "property",
        propertyKey: config.key,
        valueType: "string",
      },
    };
  }

  return {
    key: config.key,
    title: config.key,
    label: config.key,
    description: config.description,
    definition,
    control: "string",
    value: rawValue,
    source: {
      kind: "property",
      propertyKey: config.key,
      valueType: "string",
    },
  };
}

function createSyntheticPropertyDefinition(
  config: FixedPropertyFieldConfig
): ParameterDefinition {
  return {
    type: config.control === "boolean" ? "boolean" : "string",
    flag: config.key,
    description: config.description,
  };
}

function dedupeStringOptions(values: string[]): DotnetAdvancedFieldOption[] {
  const seen = new Set<string>();
  const result: DotnetAdvancedFieldOption[] = [];

  for (const rawValue of values) {
    const value = rawValue.trim();
    if (!value || seen.has(value)) {
      continue;
    }

    seen.add(value);
    result.push({ value, label: value });
  }

  return result;
}
