import { invoke } from "@tauri-apps/api/core";

export type PackageFormat = "zip";

export interface PackageResult {
  artifact_path: string;
  format: PackageFormat;
  file_count: number;
  bytes: number;
  sha256: string;
}

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

export type SignMethod = "gpg_detached";

export interface SignResult {
  signature_path: string;
  method: SignMethod;
  stdout: string;
  stderr: string;
  exit_code: number;
  success: boolean;
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

