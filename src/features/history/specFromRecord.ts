import type { ProviderPublishSpec } from "@/features/publish/publishRuntime";
import type { ExecutionRecord } from "@/lib/store/types";
import type { SpecParameters } from "@/types/parameters";

const DEFAULT_SPEC_VERSION = 1;
// 后端 PublishSpec.version 是 u32（src-tauri/src/spec.rs）。record.spec 是
// 历史记录里的不可信持久化投影，非法数值必须回退到默认版本，否则会产出
// 契约外的快照（且 NaN/Infinity 经 JSON 序列化会变成 null）。
const MAX_SPEC_VERSION = 0xffff_ffff;

function isSpecVersion(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= MAX_SPEC_VERSION
  );
}

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

  const version = isSpecVersion(payload.version)
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
