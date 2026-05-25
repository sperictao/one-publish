import { invoke } from "@tauri-apps/api/core";

import type { OutputTargetDescriptor } from "@/generated/tauri-contracts";

export type OutputTargetHintKind = "local" | "unc" | "scheme";

export interface OutputTargetHint {
  kind: OutputTargetHintKind;
  scheme?: string;
}

const SCHEME_PATTERN = /^([a-zA-Z][a-zA-Z0-9+.\-]*):\/\//;

export function parseOutputTargetLocal(raw: string): OutputTargetHint {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { kind: "local" };
  }

  const schemeMatch = trimmed.match(SCHEME_PATTERN);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (!/^[a-z]$/.test(scheme)) {
      return { kind: "scheme", scheme };
    }
  }

  if (trimmed.startsWith("\\\\") || trimmed.startsWith("//")) {
    return { kind: "unc" };
  }

  return { kind: "local" };
}

export async function parseOutputTargetRemote(
  raw: string
): Promise<OutputTargetDescriptor> {
  return await invoke<OutputTargetDescriptor>("describe_publish_output_target", {
    raw,
  });
}
