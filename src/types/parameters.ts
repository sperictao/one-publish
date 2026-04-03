import type {
  JsonValue,
  ParameterDefinition as TauriParameterDefinition,
  ParameterSchema as TauriParameterSchema,
  ParameterType,
  SpecValue,
} from "@/generated/tauri-contracts";

export type { ParameterType, SpecValue };

export type SpecParameters = Record<string, SpecValue>;

export interface ParameterDefinition
  extends Omit<TauriParameterDefinition, "multiple" | "prefix" | "description"> {
  multiple?: boolean | null;
  prefix?: string | null;
  description?: string | null;
}

export interface ParameterSchema extends Omit<TauriParameterSchema, "parameters"> {
  parameters: Record<string, ParameterDefinition>;
}

export interface ParameterValueObject {
  [key: string]: ParameterValue;
}

export interface ParameterValueArray extends Array<ParameterValue> {}

export type ParameterValue =
  | JsonValue
  | ParameterValueArray
  | ParameterValueObject;

export function toSpecValue(value: ParameterValue): SpecValue {
  if (value === null) {
    return null;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => toSpecValue(item));
  }

  const normalized: Record<string, SpecValue> = {};
  for (const [key, item] of Object.entries(value)) {
    normalized[key] = toSpecValue(item);
  }
  return normalized;
}

export function fromSpecValue(spec: SpecValue): ParameterValue {
  if (
    spec === null ||
    typeof spec === "string" ||
    typeof spec === "number" ||
    typeof spec === "boolean"
  ) {
    return spec;
  }

  if (Array.isArray(spec)) {
    return spec.map((item) => fromSpecValue(item));
  }

  const normalized: Record<string, ParameterValue> = {};
  for (const [key, value] of Object.entries(spec)) {
    normalized[key] = fromSpecValue(value);
  }
  return normalized;
}

export function normalizeParameters(
  params: Record<string, ParameterValue>
): Record<string, ParameterValue> {
  return params;
}

export function toSpecParameters(
  params: Record<string, ParameterValue>
): SpecParameters {
  const normalized: SpecParameters = {};
  for (const [key, value] of Object.entries(params)) {
    normalized[key] = toSpecValue(value);
  }
  return normalized;
}

export function fromSpecParameters(params: SpecParameters): Record<string, ParameterValue> {
  const normalized: Record<string, ParameterValue> = {};
  for (const [key, value] of Object.entries(params)) {
    normalized[key] = fromSpecValue(value);
  }
  return normalized;
}
