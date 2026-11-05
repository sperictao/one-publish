import type {
  ProviderManifest,
  ProviderProjectPathKind,
} from "@/lib/store/types";

type ProviderPresentation = Pick<
  ProviderManifest,
  | "id"
  | "displayName"
  | "label"
  | "commandExample"
  | "environmentLabel"
  | "environmentDescription"
  | "requiresProjectBinding"
  | "projectPathKind"
  | "supportsCommandImport"
>;

export interface EnvironmentProviderOption {
  id: string;
  label: string;
  description: string;
}

// Provider catalog 文案经 IPC 传入，可能缺失或只含空白；只做 `||` 判断会让
// 纯空白字符串被当成有效文案（渲染为看不见的选项）。统一按 trim 后择优选择，
// 让所有 Provider 展示路径共用同一套回退语义。
function firstNonBlank(
  ...candidates: Array<string | null | undefined>
): string | null {
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return null;
}

export function resolveProviderIdCandidate(
  providerId: string | null | undefined,
  providers: ProviderManifest[],
  fallbackProviderId = ""
): string {
  // 显式选择不能被 catalog 顺序替换；未知 Provider 交给运行时报告错误。
  return (
    providerId?.trim() || fallbackProviderId.trim() || providers[0]?.id || ""
  );
}

export function resolveProviderLabel(
  provider: ProviderPresentation | null | undefined,
  fallbackProviderId?: string
): string {
  return (
    firstNonBlank(
      provider?.label,
      provider?.displayName,
      provider?.id,
      fallbackProviderId
    ) ?? "Provider"
  );
}

export function resolveProviderCommandExample(
  provider: ProviderPresentation | null | undefined
): string {
  return provider?.commandExample?.trim() || "";
}

function resolveProviderProjectPathKind(
  provider: ProviderPresentation | null | undefined
): ProviderProjectPathKind {
  return provider?.projectPathKind ?? "repository_root";
}

export function providerUsesProjectFile(
  provider: ProviderPresentation | null | undefined
): boolean {
  return resolveProviderProjectPathKind(provider) === "project_file";
}

export function providerRequiresProjectBinding(
  provider: ProviderPresentation | null | undefined
): boolean {
  return provider?.requiresProjectBinding ?? providerUsesProjectFile(provider);
}

export function resolveEnvironmentProviderOptions(
  providers: ProviderManifest[]
): EnvironmentProviderOption[] {
  return providers.map((provider) => ({
    id: provider.id,
    label:
      firstNonBlank(
        provider.environmentLabel,
        provider.label,
        provider.displayName,
        provider.id
      ) ?? "Provider",
    description:
      firstNonBlank(
        provider.environmentDescription,
        provider.displayName,
        provider.id
      ) ?? "Provider",
  }));
}
