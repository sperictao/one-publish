import type { PublishConfigStore } from "@/lib/store";
import type { ParameterValue } from "@/types/parameters";

interface CommandImportSpec {
  provider_id?: string;
  providerId?: string;
  parameters?: Record<string, unknown>;
}

interface MapCommandImportOptions {
  supportedKeys?: string[];
}

export interface CommandImportMappingResult {
  providerId: string;
  dotnetUpdates: Partial<PublishConfigStore>;
  providerParameters: Record<string, ParameterValue>;
  mappedKeys: string[];
  unmappedKeys: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeParameterValue(value: unknown): ParameterValue | undefined {
  if (value === null) return null;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    const normalizedItems: ParameterValue[] = [];
    for (const item of value) {
      const normalized = normalizeParameterValue(item);
      if (normalized === undefined) return undefined;
      normalizedItems.push(normalized);
    }
    return normalizedItems;
  }

  if (isPlainObject(value)) {
    const normalizedObject: Record<string, ParameterValue> = {};
    for (const [key, item] of Object.entries(value)) {
      const normalized = normalizeParameterValue(item);
      if (normalized === undefined) return undefined;
      normalizedObject[key] = normalized;
    }
    return normalizedObject;
  }

  return undefined;
}

function resolveProviderId(spec: CommandImportSpec, fallbackProviderId: string) {
  const providerId = spec.provider_id || spec.providerId || fallbackProviderId;
  return providerId || fallbackProviderId;
}

function resolveParameters(spec: CommandImportSpec): Record<string, unknown> {
  if (!isPlainObject(spec.parameters)) {
    return {};
  }
  return spec.parameters;
}

export function mapImportedSpecByProvider(
  spec: CommandImportSpec,
  fallbackProviderId: string,
  options?: MapCommandImportOptions
): CommandImportMappingResult {
  const providerId = resolveProviderId(spec, fallbackProviderId);
  const parameters = resolveParameters(spec);
  const mappedKeys: string[] = [];
  const unmappedKeys: string[] = [];
  const dotnetUpdates: Partial<PublishConfigStore> = {};
  const providerParameters: Record<string, ParameterValue> = {};

  if (providerId === "dotnet") {
    for (const [key, rawValue] of Object.entries(parameters)) {
      if (key === "configuration") {
        if (typeof rawValue === "string") {
          dotnetUpdates.configuration = rawValue;
          mappedKeys.push(key);
        } else {
          unmappedKeys.push(key);
        }
        continue;
      }

      if (key === "runtime") {
        if (typeof rawValue === "string") {
          dotnetUpdates.runtime = rawValue;
          mappedKeys.push(key);
        } else {
          unmappedKeys.push(key);
        }
        continue;
      }

      if (key === "output") {
        if (typeof rawValue === "string") {
          dotnetUpdates.outputDir = rawValue;
          mappedKeys.push(key);
        } else {
          unmappedKeys.push(key);
        }
        continue;
      }

      if (key === "self_contained") {
        if (typeof rawValue === "boolean") {
          dotnetUpdates.selfContained = rawValue;
          mappedKeys.push(key);
        } else {
          unmappedKeys.push(key);
        }
        continue;
      }

      unmappedKeys.push(key);
    }

    return {
      providerId,
      dotnetUpdates,
      providerParameters,
      mappedKeys,
      unmappedKeys,
    };
  }

  const supportedKeys =
    options?.supportedKeys && options.supportedKeys.length > 0
      ? new Set(options.supportedKeys)
      : null;

  for (const [key, rawValue] of Object.entries(parameters)) {
    if (supportedKeys && !supportedKeys.has(key)) {
      unmappedKeys.push(key);
      continue;
    }

    const normalized = normalizeParameterValue(rawValue);
    if (normalized === undefined) {
      unmappedKeys.push(key);
      continue;
    }

    providerParameters[key] = normalized;
    mappedKeys.push(key);
  }

  return {
    providerId,
    dotnetUpdates,
    providerParameters,
    mappedKeys,
    unmappedKeys,
  };
}
