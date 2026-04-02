import type { ProjectScanCandidates } from "@/types/project";

function normalizeProviderId(providerId: string): string {
  const trimmed = providerId.trim();
  if (trimmed === "__none__") {
    return "";
  }
  return trimmed;
}

export interface ProjectBindingResolution {
  nextProjectFile: string;
  isManualInput: boolean;
  requiresExplicitBinding: boolean;
}

export function hasValidProjectFileBinding(
  projectFile: string,
  candidates: ProjectScanCandidates | null
): boolean {
  const nextProjectFile = projectFile.trim();
  if (!nextProjectFile) {
    return false;
  }

  return (candidates?.projectFiles ?? []).includes(nextProjectFile);
}

export function reconcileProjectBinding(
  currentProjectFile: string,
  candidates: ProjectScanCandidates | null
): ProjectBindingResolution {
  const nextProjectFile = currentProjectFile.trim();
  const projectFiles = candidates?.projectFiles ?? [];

  if (nextProjectFile && projectFiles.includes(nextProjectFile)) {
    return {
      nextProjectFile,
      isManualInput: false,
      requiresExplicitBinding: projectFiles.length > 1,
    };
  }

  if (projectFiles.length === 1) {
    return {
      nextProjectFile: projectFiles[0],
      isManualInput: false,
      requiresExplicitBinding: false,
    };
  }

  if (projectFiles.length > 1) {
    return {
      nextProjectFile: "",
      isManualInput: false,
      requiresExplicitBinding: true,
    };
  }

  return {
    nextProjectFile: "",
    isManualInput: true,
    requiresExplicitBinding: false,
  };
}

export function repositoryProjectBindingPending(params: {
  providerId: string;
  path: string;
  scanResolvedPath: string | null;
  isScanning: boolean;
}): boolean {
  const normalizedProviderId = normalizeProviderId(params.providerId);
  if (normalizedProviderId && normalizedProviderId !== "dotnet") {
    return false;
  }

  const normalizedPath = params.path.trim();
  if (!normalizedPath) {
    return false;
  }

  return params.isScanning || params.scanResolvedPath !== normalizedPath;
}

export function repositoryRequiresProjectBinding(params: {
  providerId: string;
  candidates: ProjectScanCandidates | null;
  projectFile: string;
}): boolean {
  const normalizedProviderId = normalizeProviderId(params.providerId);
  if (normalizedProviderId && normalizedProviderId !== "dotnet") {
    return false;
  }

  return (
    (params.candidates?.projectFiles.length ?? 0) > 1 &&
    !hasValidProjectFileBinding(params.projectFile, params.candidates)
  );
}
