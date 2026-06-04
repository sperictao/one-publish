import { parseDotnetBooleanValue } from "@/features/config/dotnetPublishAdvancedFields";
import {
  extractDotnetPublishParametersFromProjectProfile,
  type ParsedProjectPublishProfile,
  type ProjectPublishProfileEntry,
  type ProjectPublishProfileSection,
} from "@/lib/projectPublishProfileXml";

export interface ProjectPublishProfileSupplementSection
  extends ProjectPublishProfileSection {}

export function buildProjectPublishProfileSupplementSections(
  parsedProfile: ParsedProjectPublishProfile
): ProjectPublishProfileSupplementSection[] {
  const extractedParameters =
    extractDotnetPublishParametersFromProjectProfile(parsedProfile);
  const mappedProperties = normalizePropertyValueMap(
    extractedParameters.properties
  );

  return parsedProfile.sections.flatMap((section) => {
    if (section.tagName !== "PropertyGroup") {
      return [section];
    }

    const filteredEntries = section.entries.filter((entry) =>
      shouldKeepPropertyGroupEntry({
        entry,
        extractedParameters,
        mappedProperties,
      })
    );

    if (
      filteredEntries.length === 0 &&
      Object.keys(section.attributes).length === 0
    ) {
      return [];
    }

    return [
      {
        ...section,
        entries: filteredEntries,
      },
    ];
  });
}

function shouldKeepPropertyGroupEntry(params: {
  entry: ProjectPublishProfileEntry;
  extractedParameters: Record<string, unknown>;
  mappedProperties: Record<string, string>;
}): boolean {
  const { entry, extractedParameters, mappedProperties } = params;

  if (entry.path.includes(".")) {
    return true;
  }

  if (Object.keys(entry.attributes).length > 0) {
    return true;
  }

  const key = entry.path.trim();
  if (!key) {
    return false;
  }

  const value = entry.value.trim();
  if (!value) {
    return true;
  }

  if (isDirectlyMappedPropertyGroupEntry({ key, value, extractedParameters })) {
    return false;
  }

  return mappedProperties[key] !== value;
}

function isDirectlyMappedPropertyGroupEntry(params: {
  key: string;
  value: string;
  extractedParameters: Record<string, unknown>;
}): boolean {
  const { key, value, extractedParameters } = params;

  switch (key) {
    case "Configuration":
      return extractedParameters.configuration === value;
    case "RuntimeIdentifier":
      return extractedParameters.runtime === value;
    case "TargetFramework":
      return extractedParameters.framework === value;
    case "PublishDir":
      return extractedParameters.output === value;
    case "SelfContained":
      return matchesBooleanParameter(extractedParameters.self_contained, value);
    case "NoBuild":
      return matchesBooleanParameter(extractedParameters.no_build, value);
    case "NoRestore":
      return matchesBooleanParameter(extractedParameters.no_restore, value);
    case "NoLogo":
      return matchesBooleanParameter(extractedParameters.no_logo, value);
    case "Verbosity":
    case "MSBuildVerbosity":
      return extractedParameters.verbosity === value;
    default:
      return false;
  }
}

function matchesBooleanParameter(
  candidate: unknown,
  rawValue: string
): boolean {
  const parsedValue = parseDotnetBooleanValue(rawValue);
  return parsedValue !== null && candidate === parsedValue;
}

function normalizePropertyValueMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const entries: [string, string][] = [];

  for (const [key, itemValue] of Object.entries(value)) {
    if (typeof key !== "string" || typeof itemValue !== "string") {
      continue;
    }

    const normalizedKey = key.trim();
    const normalizedValue = itemValue.trim();
    if (normalizedKey && normalizedValue) {
      entries.push([normalizedKey, normalizedValue]);
    }
  }

  return Object.fromEntries(entries);
}
