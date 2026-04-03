import { invoke } from "@tauri-apps/api/core";
import type {
  PackageFormat,
  PackageResult,
  SignMethod,
  SignResult,
} from "@/generated/tauri-contracts";

export type { PackageFormat, PackageResult, SignMethod, SignResult };

export async function packageArtifact(params: {
  inputDir: string;
  outputPath: string;
  format?: PackageFormat;
  includeRootDir?: boolean;
}): Promise<PackageResult> {
  const { inputDir, outputPath, format = "zip", includeRootDir = true } = params;

  return await invoke<PackageResult>("package_artifact", {
    inputDir,
    outputPath,
    format,
    includeRootDir,
  });
}

export async function signArtifact(params: {
  artifactPath: string;
  method?: SignMethod;
  outputPath?: string;
  keyId?: string;
}): Promise<SignResult> {
  const { artifactPath, method = "gpg_detached", outputPath, keyId } = params;

  return await invoke<SignResult>("sign_artifact", {
    artifactPath,
    method,
    outputPath,
    keyId,
  });
}
