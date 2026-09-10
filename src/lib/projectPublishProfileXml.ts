import { getPathBasename, joinPath } from "@/lib/paths";
import type { ParameterValue } from "@/types/parameters";

export interface ProjectPublishProfileEntry {
  key: string;
  path: string;
  value: string;
  attributes: Record<string, string>;
}

export interface ProjectPublishProfileSection {
  id: string;
  title: string;
  tagName: string;
  path: string;
  attributes: Record<string, string>;
  entries: ProjectPublishProfileEntry[];
}

export interface ParsedProjectPublishProfile {
  rootTagName: string;
  rawXml: string;
  sections: ProjectPublishProfileSection[];
}

type DotnetProfileParameterValue =
  string | boolean | string[] | Record<string, string>;

const TEXT_NODE = 3;
const CDATA_SECTION_NODE = 4;

function getElementAttributes(element: Element): Record<string, string> {
  return Object.fromEntries(
    Array.from(element.attributes).map((attribute) => [
      attribute.name,
      attribute.value,
    ])
  );
}

function getOwnTextContent(element: Element): string {
  return Array.from(element.childNodes)
    .flatMap((node) =>
      node.nodeType === TEXT_NODE || node.nodeType === CDATA_SECTION_NODE
        ? [node.textContent ?? ""]
        : []
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function collectSectionEntries(
  element: Element,
  parentPath: string[],
  entries: ProjectPublishProfileEntry[]
) {
  const currentPath = [...parentPath, element.tagName];
  const attributes = getElementAttributes(element);
  const ownTextContent = getOwnTextContent(element);
  const childElements = Array.from(element.children);

  if (
    Object.keys(attributes).length > 0 ||
    ownTextContent.length > 0 ||
    childElements.length === 0
  ) {
    entries.push({
      key: currentPath.join(" › "),
      path: currentPath.join("."),
      value: ownTextContent,
      attributes,
    });
  }

  for (const childElement of childElements) {
    collectSectionEntries(childElement, currentPath, entries);
  }
}

export function parseProjectPublishProfileXml(
  xml: string
): ParsedProjectPublishProfile {
  const rawXml = xml.trim();
  if (!rawXml) {
    throw new Error("Empty publish profile XML.");
  }

  const document = new DOMParser().parseFromString(rawXml, "application/xml");
  const parserError = document.querySelector("parsererror");
  if (parserError) {
    throw new Error(parserError.textContent?.trim() || "Invalid XML.");
  }

  const root = document.documentElement;
  if (!root) {
    throw new Error("Missing XML root element.");
  }

  const sectionElements = Array.from(root.children);
  const totalByTagName = new Map<string, number>();
  const currentByTagName = new Map<string, number>();

  for (const sectionElement of sectionElements) {
    totalByTagName.set(
      sectionElement.tagName,
      (totalByTagName.get(sectionElement.tagName) ?? 0) + 1
    );
  }

  const sections = sectionElements.map((sectionElement, index) => {
    const sectionTagName = sectionElement.tagName;
    const currentIndex = (currentByTagName.get(sectionTagName) ?? 0) + 1;
    currentByTagName.set(sectionTagName, currentIndex);

    const totalCount = totalByTagName.get(sectionTagName) ?? 1;
    const entries: ProjectPublishProfileEntry[] = [];
    const childElements = Array.from(sectionElement.children);
    const ownTextContent = getOwnTextContent(sectionElement);

    for (const childElement of childElements) {
      collectSectionEntries(childElement, [], entries);
    }

    if (childElements.length === 0 && ownTextContent.length > 0) {
      entries.push({
        key: sectionTagName,
        path: sectionTagName,
        value: ownTextContent,
        attributes: {},
      });
    }

    return {
      id: `${sectionTagName}-${index + 1}`,
      title:
        totalCount > 1 ? `${sectionTagName} #${currentIndex}` : sectionTagName,
      tagName: sectionTagName,
      path: sectionTagName,
      attributes: getElementAttributes(sectionElement),
      entries,
    };
  });

  return {
    rootTagName: root.tagName,
    rawXml,
    sections,
  };
}

export const DOTNET_UNSUPPORTED_PUBLISH_PROPERTY_KEYS = [
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

/**
 * 项目发布配置参数归一化：缺省输出目录时按当前默认目录派生作用域路径；
 * 属性映射中的 DeleteExistingFiles 提升为一等 delete_existing_files 参数
 * （显式 true 生效；false 仅从属性集中清除，与后端默认语义一致）。
 * 直接在原始参数上运算，不做任何富表单往返。
 */
export function normalizeProjectProfileParameters(params: {
  parameters: Record<string, ParameterValue>;
  defaultOutputDir?: string;
  projectFile?: string;
  projectRoot?: string;
}): Record<string, ParameterValue> {
  const { parameters } = params;
  const next: Record<string, ParameterValue> = { ...parameters };

  const properties: Record<string, string> = {
    ...(typeof next.properties === "object" &&
    next.properties &&
    !Array.isArray(next.properties)
      ? (next.properties as Record<string, string>)
      : {}),
  };
  const rawDeleteExistingFiles =
    properties.DeleteExistingFiles ?? properties.deleteExistingFiles;
  if (typeof rawDeleteExistingFiles === "string") {
    const parsed = parseDotnetBooleanValue(rawDeleteExistingFiles);
    delete properties.DeleteExistingFiles;
    delete properties.deleteExistingFiles;
    if (parsed === true && next.delete_existing_files === undefined) {
      next.delete_existing_files = true;
    }
  }
  if (Object.keys(properties).length > 0) {
    next.properties = properties;
  } else {
    delete next.properties;
  }

  if (
    (typeof next.output !== "string" || !next.output.trim()) &&
    params.defaultOutputDir
  ) {
    const scopedOutput = buildDefaultScopedOutputDir({
      defaultOutputDir: params.defaultOutputDir,
      projectFile: params.projectFile,
      projectRoot: params.projectRoot,
      configuration:
        typeof next.configuration === "string" ? next.configuration : undefined,
    });
    if (scopedOutput) {
      next.output = scopedOutput;
    }
  }

  return next;
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

export function extractDotnetPublishParametersFromProjectProfile(
  parsedProfile: ParsedProjectPublishProfile
): Record<string, DotnetProfileParameterValue> {
  const parameters: Record<string, DotnetProfileParameterValue> = {};
  const properties: Record<string, string> = {};

  for (const section of parsedProfile.sections) {
    if (section.tagName !== "PropertyGroup") {
      continue;
    }

    for (const entry of section.entries) {
      if (/\./.test(entry.path)) {
        continue;
      }

      const key = entry.path.trim();
      const value = entry.value.trim();

      if (!key || !value) {
        continue;
      }

      switch (key) {
        case "Configuration":
          parameters.configuration = value;
          break;
        case "RuntimeIdentifier":
          parameters.runtime = value;
          break;
        case "TargetFramework":
          parameters.framework = value;
          break;
        case "PublishDir":
          parameters.output = value;
          break;
        case "SelfContained": {
          const resolved = parseDotnetBooleanValue(value);
          if (resolved !== null) {
            parameters.self_contained = resolved;
          }
          break;
        }
        case "NoBuild": {
          const resolved = parseDotnetBooleanValue(value);
          if (resolved !== null) {
            parameters.no_build = resolved;
          }
          break;
        }
        case "NoRestore": {
          const resolved = parseDotnetBooleanValue(value);
          if (resolved !== null) {
            parameters.no_restore = resolved;
          }
          break;
        }
        case "Verbosity":
        case "MSBuildVerbosity":
          parameters.verbosity = value;
          break;
        case "NoLogo": {
          const resolved = parseDotnetBooleanValue(value);
          if (resolved !== null) {
            parameters.no_logo = resolved;
          }
          break;
        }
        default:
          properties[key] = value;
          break;
      }
    }
  }

  const supportedProperties = sanitizeDotnetPublishProperties(properties);
  if (Object.keys(supportedProperties).length > 0) {
    parameters.properties = supportedProperties;
  }

  return parameters;
}
