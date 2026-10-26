import type {
  JsonValue,
  ParameterDefinition as TauriParameterDefinition,
  ParameterSchema as TauriParameterSchema,
  SpecValue,
} from "@/generated/tauri-contracts";

export type { SpecValue };

export type SpecParameters = Record<string, SpecValue>;

export interface ParameterDefinition extends Omit<
  TauriParameterDefinition,
  "multiple" | "prefix" | "description"
> {
  multiple?: boolean | null;
  prefix?: string | null;
  description?: string | null;
}

export interface ParameterSchema extends Omit<
  TauriParameterSchema,
  "parameters"
> {
  parameters: Record<string, ParameterDefinition>;
}

interface ParameterValueObject {
  [key: string]: ParameterValue;
}

type ParameterValueArray = Array<ParameterValue>;

export type ParameterValue =
  JsonValue | ParameterValueArray | ParameterValueObject;

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
