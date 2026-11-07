import {
  extractDotnetPublishParametersFromProjectProfile,
  parseDotnetBooleanValue,
  type ParsedProjectPublishProfile,
  type ProjectPublishProfileEntry,
  type ProjectPublishProfileSection,
} from "@/lib/projectPublishProfileXml";

export type ProjectPublishProfileSupplementSection =
  ProjectPublishProfileSection;

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

  // 与 extractDotnetPublishParametersFromProjectProfile 共用同一套小写归一：
  // MSBuild 属性名大小写不敏感，.pubxml 又是用户可手写的 XML。这里的「已由
  // 主表单表达」判定必须与提取器一致，否则大小写变体已被映射为一等参数，
  // 却因匹配不上 PascalCase 标签而重复出现在补充区。key 仍保留原始拼写，
  // 供下方 mappedProperties 的兜底比较使用。
  switch (key.toLowerCase()) {
    case "configuration":
      return extractedParameters.configuration === value;
    case "runtimeidentifier":
      return extractedParameters.runtime === value;
    case "targetframework":
      return extractedParameters.framework === value;
    case "publishdir":
      return extractedParameters.output === value;
    case "selfcontained":
      return matchesBooleanParameter(extractedParameters.self_contained, value);
    case "nobuild":
      return matchesBooleanParameter(extractedParameters.no_build, value);
    case "norestore":
      return matchesBooleanParameter(extractedParameters.no_restore, value);
    case "nologo":
      return matchesBooleanParameter(extractedParameters.no_logo, value);
    case "verbosity":
    case "msbuildverbosity":
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
