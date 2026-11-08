import type { ProviderPublishSpec } from "@/features/publish/publishRuntime";

type HandoffSpec = Pick<
  ProviderPublishSpec,
  "provider_id" | "project_path" | "parameters"
>;

export type HandoffSnippetFormat = "shell" | "github-actions" | "gitlab-ci";

function normalizeCommandLine(commandLine?: string | null): string | null {
  if (!commandLine) {
    return null;
  }

  // 引号内的空白是参数值本身的一部分：后端 build_display_command 会给含空白的
  // 参数加双引号（用户目录名 "My  Project"、Windows 路径里的连续空格/制表符等），
  // 全局折叠会把这些路径改写成另一个目录，交接片段复制执行后即指向错误位置。
  // 因此只折叠引号外的空白，仍保证 display_command 即使含换行也只生成单行片段；
  // 双引号参数里的 \\ 与 \" 转义按原样整段保留，不做二次解析。
  const normalized = commandLine
    .replace(/^\$\s*/, "")
    .replace(/"(?:\\.|[^"\\])*"|\s+/g, (token) =>
      token.startsWith('"') ? token : " "
    )
    .trim();

  return normalized || null;
}

// project_path 可能是历史记录里不可信的持久化 spec 投影（见 extractSpecFromRecord）。
// 纯空白路径没有可用的项目位置，与 inferWorkingDirectory 一致地回退到当前目录 "."，
// 否则 fallback 命令会生成 `dotnet publish "   "`（不可执行），shell 注释也只剩空白。
// 非纯空白路径逐字保留（含首尾空格、反斜杠），正常交接片段行为不变。
function resolveProjectPath(projectPath: string): string {
  return projectPath.trim() ? projectPath : ".";
}

// cargo/go/java 的 project_path 是仓库根目录（src-tauri ProviderProjectPathKind::RepositoryRoot），
// 目录名可以合法含 '.'（my.app、site.dev），不能按「含点即文件」剥掉最后一级；
// dotnet/tauri 的 project_path 是项目文件，仍走下方文件名启发式。
const REPOSITORY_ROOT_PROVIDER_IDS: ReadonlySet<string> = new Set([
  "cargo",
  "go",
  "java",
]);

function inferWorkingDirectory(spec: HandoffSpec): string {
  const normalized = spec.project_path.replace(/\\/g, "/");
  // project_path 可能来自历史记录里不可信的持久化 spec 投影（见 extractSpecFromRecord）。
  // 空路径已回退到当前目录，纯空白路径同样没有可用目录信息；否则三个片段会生成
  // `cd "   "` / `working-directory:    ` 这类不可执行的交接命令。与
  // normalizeCommandLine 一致地按 trim 判定空白，非纯空白路径仍逐字保留。
  if (!normalized.trim()) {
    return ".";
  }

  if (REPOSITORY_ROOT_PROVIDER_IDS.has(spec.provider_id)) {
    return normalized;
  }

  const segment = normalized.split("/").pop() || "";
  const looksLikeFile = segment.includes(".") && !normalized.endsWith("/");

  if (!looksLikeFile) {
    return normalized;
  }

  const idx = normalized.lastIndexOf("/");
  if (idx < 0) {
    // 裸文件名（如 "App.csproj"）没有目录信息，只能回退到当前目录。
    return ".";
  }
  if (idx === 0) {
    // 根目录单文件（如 "/App.csproj"）的父目录是文件系统根 "/"，
    // 而不是片段被执行时的当前目录。
    return "/";
  }

  const parent = normalized.slice(0, idx);
  if (/^[a-zA-Z]:$/.test(parent)) {
    // 盘符根下的单文件（如 "C:/App.csproj"）父目录应是盘符根 "C:/"。
    // 不带斜杠的 "C:" 在 Windows 上表示「C 盘的当前目录」，会指向错误位置。
    return `${parent}/`;
  }

  return parent;
}

function buildFallbackCommand(spec: HandoffSpec): string {
  if (spec.provider_id === "dotnet") {
    return `dotnet publish "${resolveProjectPath(spec.project_path)}"`;
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

  return `# ${spec.provider_id}: 未提供实际构建命令，请从发布计划复制已选定的命令。`;
}

function resolveCommand(
  spec: HandoffSpec,
  commandLine?: string | null
): string {
  return normalizeCommandLine(commandLine) || buildFallbackCommand(spec);
}

export function buildShellHandoffSnippet(params: {
  spec: HandoffSpec;
  commandLine?: string | null;
}): string {
  const command = resolveCommand(params.spec, params.commandLine);
  const workingDir = inferWorkingDirectory(params.spec);

  return [
    "# OnePublish handoff snippet (shell)",
    `# provider: ${params.spec.provider_id}`,
    `# project: ${resolveProjectPath(params.spec.project_path)}`,
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
  const workingDir = inferWorkingDirectory(params.spec);

  return [
    `- name: Publish (${params.spec.provider_id})`,
    `  working-directory: ${workingDir}`,
    "  run: |",
    `    ${command}`,
  ].join("\n");
}

export function buildGitLabCISnippet(params: {
  spec: HandoffSpec;
  commandLine?: string | null;
}): string {
  const command = resolveCommand(params.spec, params.commandLine);
  const workingDir = inferWorkingDirectory(params.spec);

  return [
    "publish:",
    "  stage: deploy",
    "  script:",
    `    - cd "${workingDir}"`,
    `    - ${command}`,
  ].join("\n");
}
