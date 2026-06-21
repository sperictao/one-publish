export const GEIST_PROTOTYPE_VARIANT = "A" as const;

export type GeistPrototypeVariant = typeof GEIST_PROTOTYPE_VARIANT;

export const GEIST_PROTOTYPE_VARIANT_LABEL = "A - Dense Workbench";

export function isGeistPrototypeVariant(
  value: string | null
): value is GeistPrototypeVariant {
  return value === GEIST_PROTOTYPE_VARIANT;
}
