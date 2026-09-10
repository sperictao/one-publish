import { useMemo } from "react";

import type { ConfigParameters } from "@/lib/store/types";
import type { ParameterValue } from "@/types/parameters";

export function useDialogDerivedState(params: {
  activeProviderId: string;
  activeProviderUsesProjectFile?: boolean;
  /** 当前作用域（草稿/修订）的原始参数；null 表示没有可用的作用域水合。 */
  selectionParameters: Record<string, ParameterValue> | null;
  activeProviderParameters: Record<string, ParameterValue>;
  projectFile?: string | null;
  selectedRepoPath?: string | null;
}) {
  const providerUsesProjectFile = params.activeProviderUsesProjectFile ?? false;
  const commandImportProjectPath = useMemo(() => {
    if (providerUsesProjectFile) {
      return params.projectFile || "";
    }
    return params.selectedRepoPath || "";
  }, [params.projectFile, params.selectedRepoPath, providerUsesProjectFile]);

  // 所有 Provider 共用同一水合协议：作用域参数优先（活水合），
  // 无作用域时回落到会话内已加载的 Provider 参数。
  const currentConfigParameters: ConfigParameters =
    params.selectionParameters ?? params.activeProviderParameters;

  return {
    commandImportProjectPath,
    currentConfigParameters,
  };
}
