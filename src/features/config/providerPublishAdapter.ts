import { buildDotnetProfileParameters } from "@/features/config/dotnetPublishConfig";

// 统一发布输入方案 Phase 5：前端不再构造执行 spec；本模块仅保留 dotnet
// 富表单视图 → 参数的过渡转换（编辑器替换为 schema 表单后随之删除）。
export type DotnetPublishIntentConfig = {
  configuration: string;
  runtime: string;
  framework: string;
  self_contained: boolean;
  output_dir: string;
  no_build: boolean;
  no_restore: boolean;
  verbosity: string;
  no_logo: boolean;
  delete_existing_files: boolean;
  properties: Record<string, string>;
  use_profile: boolean;
  profile_name: string;
};

export function buildDotnetProviderParameters(
  config: DotnetPublishIntentConfig
) {
  return buildDotnetProfileParameters({
    configuration: config.configuration,
    runtime: config.runtime,
    framework: config.framework,
    selfContained: config.self_contained,
    outputDir: config.output_dir,
    noBuild: config.no_build,
    noRestore: config.no_restore,
    verbosity: config.verbosity,
    noLogo: config.no_logo,
    deleteExistingFiles: config.delete_existing_files,
    properties: config.properties,
    useProfile: config.use_profile,
    profileName: config.profile_name,
  });
}
