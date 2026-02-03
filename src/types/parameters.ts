/**
 * Parameter Schema Types
 */

export interface ParameterSchema {
  parameters: Record<string, ParameterDefinition>;
}

export interface ParameterDefinition {
  type: 'boolean' | 'string' | 'array' | 'map';
  flag: string;
  multiple?: boolean;
  prefix?: string;
  description?: string;
}

/**
 * Spec Value Types (matches Rust SpecValue)
 */
export type SpecValue = SpecNull | SpecBool | SpecNumber | SpecString | SpecArray | SpecMap;

export interface SpecNull {
  type: 'null';
}

export interface SpecBool {
  type: 'bool';
  value: boolean;
}

export interface SpecNumber {
  type: 'number';
  value: number;
}

export interface SpecString {
  type: 'string';
  value: string;
}

export interface SpecArray {
  type: 'array';
  value: SpecValue[];
}

export interface SpecMap {
  type: 'map';
  value: Record<string, SpecValue>;
}

/**
 * Simplified parameter value for UI (JSON-serializable)
 * Using interface to support recursive types
 */
export interface ParameterValueObject {
  [key: string]: ParameterValue;
}
export interface ParameterValueArray extends Array<ParameterValue> {}

export type ParameterValue = null | boolean | number | string | ParameterValueArray | ParameterValueObject;

/**
 * Convert ParameterValue to SpecValue
 */
export function toSpecValue(value: ParameterValue): SpecValue {
  if (value === null) {
    return { type: 'null' };
  }
  if (typeof value === 'boolean') {
    return { type: 'bool', value };
  }
  if (typeof value === 'number') {
    return { type: 'number', value };
  }
  if (typeof value === 'string') {
    return { type: 'string', value };
  }
  if (Array.isArray(value)) {
    return { type: 'array', value: value.map(toSpecValue) };
  }
  if (typeof value === 'object') {
    const map: Record<string, SpecValue> = {};
    for (const [key, val] of Object.entries(value)) {
      map[key] = toSpecValue(val);
    }
    return { type: 'map', value: map };
  }
  return { type: 'null' };
}

/**
 * Convert SpecValue to ParameterValue
 */
export function fromSpecValue(spec: SpecValue): ParameterValue {
  switch (spec.type) {
    case 'null':
      return null;
    case 'bool':
      return spec.value;
    case 'number':
      return spec.value;
    case 'string':
      return spec.value;
    case 'array':
      return spec.value.map(fromSpecValue);
    case 'map':
      const obj: Record<string, ParameterValue> = {};
      for (const [key, val] of Object.entries(spec.value)) {
        obj[key] = fromSpecValue(val);
      }
      return obj;
  }
}

/**
 * Convert backend parameters (flat key-value) to ParameterValue map
 */
export function normalizeParameters(params: Record<string, ParameterValue>): Record<string, ParameterValue> {
  return params;
}
