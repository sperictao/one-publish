export interface HandoffSpec {
  provider_id: string;
  project_path: string;
  parameters: Record<string, unknown>;
}

export type HandoffSnippetFormat = "shell" | "github-actions";

function normalizeCommandLine(commandLine?: string | null): string | null {
  if (!commandLine) {
    return null;
  }

  const normalized = commandLine
    .replace(/^\$\s*/, "")
    .replace(/\s+/g, " ")
    .trim();

  return normalized || null;
}

function inferWorkingDirectory(projectPath: string): string {
  const normalized = projectPath.replace(/\\/g, "/");
  if (!normalized) {
    return ".";
  }

  const segment = normalized.split("/").pop() || "";
  const looksLikeFile = segment.includes(".") && !normalized.endsWith("/");

  if (!looksLikeFile) {
    return normalized;
  }

  const idx = normalized.lastIndexOf("/");
  if (idx <= 0) {
    return ".";
  }

  return normalized.slice(0, idx);
}

function buildFallbackCommand(spec: HandoffSpec): string {
  if (spec.provider_id === "dotnet") {
    return `dotnet publish "${spec.project_path}"`;
  }
  if (spec.provider_id === "cargo") {
    return "cargo build --release";
  }
  if (spec.provider_id === "go") {
    return "go build ./...";
  }
  if (spec.provider_id === "java") {
    return "./gradlew build";
  }

  return spec.provider_id;
}

function resolveCommand(spec: HandoffSpec, commandLine?: string | null): string {
  return normalizeCommandLine(commandLine) || buildFallbackCommand(spec);
}

export function buildShellHandoffSnippet(params: {
  spec: HandoffSpec;
  commandLine?: string | null;
}): string {
  const command = resolveCommand(params.spec, params.commandLine);
  const workingDir = inferWorkingDirectory(params.spec.project_path);

  return [
    "# OnePublish handoff snippet (shell)",
    `# provider: ${params.spec.provider_id}`,
    `# project: ${params.spec.project_path}`,
    `# parameters: ${JSON.stringify(params.spec.parameters)}`,
    `cd "${workingDir}"`,
    command,
  ].join("\n");
}

export function buildGitHubActionsSnippet(params: {
  spec: HandoffSpec;
  commandLine?: string | null;
}): string {
  const command = resolveCommand(params.spec, params.commandLine);
  const workingDir = inferWorkingDirectory(params.spec.project_path);

  return [
    `- name: Publish (${params.spec.provider_id})`,
    `  working-directory: ${workingDir}`,
    "  run: |",
    `    ${command}`,
  ].join("\n");
}
