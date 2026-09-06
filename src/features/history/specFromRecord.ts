import type { ProviderPublishSpec } from "@/features/publish/publishRuntime";
import type { ExecutionRecord } from "@/lib/store/types";
import type { SpecParameters } from "@/types/parameters";

const DEFAULT_SPEC_VERSION = 1;

/**
 * 从执行记录的只读 spec 投影恢复参数快照（交接片段/诊断导出用）。
 * 历史重跑不使用该路径——统一协议下 rerun 走 history 来源。
 */
export function extractSpecFromRecord(
  record: ExecutionRecord
): ProviderPublishSpec | null {
  const raw = record.spec;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const payload = raw as Record<string, unknown>;
  const providerId = payload.provider_id;
  const projectPath = payload.project_path;
  if (typeof providerId !== "string" || typeof projectPath !== "string") {
    return null;
  }

  const version =
    typeof payload.version === "number"
      ? payload.version
      : DEFAULT_SPEC_VERSION;
  const parametersRaw = payload.parameters;
  const parameters =
    parametersRaw &&
    typeof parametersRaw === "object" &&
    !Array.isArray(parametersRaw)
      ? (parametersRaw as SpecParameters)
      : {};

  return {
    version,
    provider_id: providerId,
    project_path: projectPath,
    parameters,
  };
}
