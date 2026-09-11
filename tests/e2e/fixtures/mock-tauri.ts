/**
 * Mock Tauri IPC layer for Playwright E2E tests.
 *
 * Injects a fake `window.__TAURI_INTERNALS__` so the React app can
 * boot and exercise all UI paths without a real Rust backend.
 * The mock is self-contained per-test (no shared state).
 *
 * Usage in a spec file:
 *   import { installMockTauri, gotoApp } from '../fixtures/mock-tauri';
 *   test('...', async ({ page }) => {
 *     await gotoApp(page);
 *     // app is fully interactive
 *   });
 */
import { expect, type Page } from "@playwright/test";

import type {
  AppState,
  Branch,
  ConfigProfile,
  EnvironmentCheckResult,
  JsonValue,
  ParameterSchema,
  PublishSelectionRef,
  PublishSpec,
  ProviderCatalogEntry,
  Repository,
  ScopedPublishDraft,
} from "@/generated/tauri-contracts";

// ─── Default test data ───

const DEFAULT_BRANCHES: Branch[] = [
  {
    name: "main",
    isMain: true,
    isCurrent: true,
    path: "/workspace/alpha-service",
    commitCount: 42,
  },
  {
    name: "develop",
    isMain: false,
    isCurrent: false,
    path: "/workspace/alpha-service",
    commitCount: 18,
  },
  {
    name: "feature/test-ci",
    isMain: false,
    isCurrent: false,
    path: "/workspace/alpha-service",
    commitCount: 5,
  },
];

function createConfigProfile(
  id: string,
  name: string,
  createdAt: string
): ConfigProfile {
  const revisionId = `${id}-revision-1`;
  return {
    id,
    name,
    profileGroup: null,
    createdAt,
    isSystemDefault: false,
    isDraft: false,
    currentRevisionId: revisionId,
    revisions: [
      {
        id: revisionId,
        sequence: 1,
        createdAt,
        contractVersion: 1,
        providerId: "dotnet",
        providerVersion: "1",
        settingsVersion: 1,
        parameters: {},
        composition: {
          executionBackend: {
            adapterId: "local-execution",
            settingsVersion: 1,
            settings: {},
            credentials: {},
          },
          artifactStore: {
            adapterId: "temporary-artifact-store",
            settingsVersion: 1,
            settings: {},
            credentials: {},
          },
          artifactProcessors: [
            {
              adapterId: "checksum",
              settingsVersion: 1,
              settings: {},
              credentials: {},
            },
          ],
          deliveryRoutes: [
            {
              routeId: "local-delivery",
              required: true,
              destination: {
                adapterId: "local-directory",
                settingsVersion: 1,
                settings: {},
                credentials: {},
              },
            },
          ],
        },
      },
    ],
    deletedAt: null,
    blockedReason: null,
  };
}

const DEFAULT_REPOSITORIES: Repository[] = [
  {
    id: "repo-a",
    name: "alpha-service",
    path: "/workspace/alpha-service",
    currentBranch: "main",
    branches: DEFAULT_BRANCHES,
    isMain: true,
    providerId: "dotnet",
    projectFile: "/workspace/alpha-service/App.csproj",
    publishConfig: {
      selection: {
        kind: "projectProfile" as const,
        providerId: "dotnet",
        reference: "FolderProfile",
      },
      profiles: [
        createConfigProfile(
          "profile-folder",
          "FolderProfile",
          "2025-01-01T00:00:00Z"
        ),
        createConfigProfile(
          "profile-zip",
          "ZipProfile",
          "2025-01-02T00:00:00Z"
        ),
      ],
      bindings: [],
      appliedBundles: [],
      drafts: [],
    },
  },
  {
    id: "repo-b",
    name: "beta-worker",
    path: "/workspace/beta-worker",
    currentBranch: "release",
    branches: [
      {
        name: "release",
        isMain: true,
        isCurrent: true,
        path: "/workspace/beta-worker",
        commitCount: 12,
      },
    ],
    isMain: false,
    providerId: "dotnet",
    projectFile: "/workspace/beta-worker/Worker.csproj",
    publishConfig: {
      selection: {
        kind: "projectProfile" as const,
        providerId: "dotnet",
        reference: "FolderProfile",
      },
      profiles: [
        createConfigProfile(
          "profile-folder",
          "FolderProfile",
          "2025-01-01T00:00:00Z"
        ),
      ],
      bindings: [],
      appliedBundles: [],
      drafts: [],
    },
  },
];

const DEFAULT_APP_STATE: AppState = {
  repositories: DEFAULT_REPOSITORIES,
  selectedRepoId: "repo-a",
  leftPanelWidth: 220,
  middlePanelWidth: 320,
  panelWidthsCustomized: false,
  minimizeToTrayOnClose: true,
  language: "zh",
  defaultOutputDir: "",
  theme: "auto",
  executionHistoryLimit: 20,
  environmentProviderIds: ["dotnet"],
  recentRepoIds: ["repo-a"],
  recentConfigKeysByRepo: {},
  startupNotice: null,
  executionHistory: [],
};

const DEFAULT_PROVIDERS: ProviderCatalogEntry[] = [
  {
    id: "dotnet",
    display_name: "dotnet",
    version: "8.0.0",
    label: ".NET SDK",
    command_example: "dotnet publish",
    environment_label: "dotnet 8.0",
    environment_description: ".NET SDK 8.0.403",
    requires_project_binding: true,
    project_path_kind: "project_file",
    supports_command_import: true,
    supports_project_profiles: true,
    templates: [],
  },
  {
    id: "cargo",
    display_name: "cargo",
    version: "1.82.0",
    label: "Cargo",
    command_example: "cargo publish",
    environment_label: "cargo 1.82",
    environment_description: "Rust toolchain 1.82.0",
    requires_project_binding: true,
    project_path_kind: "repository_root",
    supports_command_import: false,
    supports_project_profiles: false,
    templates: [],
  },
  {
    id: "go",
    display_name: "go",
    version: "1.23.0",
    label: "Go",
    command_example: "go build",
    environment_label: "go 1.23",
    environment_description: "Go 1.23.0",
    requires_project_binding: true,
    project_path_kind: "repository_root",
    supports_command_import: false,
    supports_project_profiles: false,
    templates: [],
  },
];

const DOTNET_SCHEMA: ParameterSchema = {
  parameters: {
    configuration: {
      type: "string",
      flag: "--configuration",
      multiple: null,
      prefix: null,
      description: null,
    },
    runtime: {
      type: "string",
      flag: "--runtime",
      multiple: null,
      prefix: null,
      description: null,
    },
    framework: {
      type: "string",
      flag: "--framework",
      multiple: null,
      prefix: null,
      description: null,
    },
    selfContained: {
      type: "boolean",
      flag: "--self-contained",
      multiple: null,
      prefix: null,
      description: null,
    },
    outputDir: {
      type: "string",
      flag: "--output",
      multiple: null,
      prefix: null,
      description: null,
    },
    noBuild: {
      type: "boolean",
      flag: "--no-build",
      multiple: null,
      prefix: null,
      description: null,
    },
    noRestore: {
      type: "boolean",
      flag: "--no-restore",
      multiple: null,
      prefix: null,
      description: null,
    },
    verbosity: {
      type: "string",
      flag: "--verbosity",
      multiple: null,
      prefix: null,
      description: null,
    },
    noLogo: {
      type: "boolean",
      flag: "--nologo",
      multiple: null,
      prefix: null,
      description: null,
    },
    properties: {
      type: "map",
      flag: "--property",
      multiple: null,
      prefix: null,
      description: null,
    },
    define: {
      type: "array",
      flag: "--define",
      multiple: null,
      prefix: null,
      description: null,
    },
    useProfile: {
      type: "boolean",
      flag: "",
      multiple: null,
      prefix: null,
      description: null,
    },
    profileName: {
      type: "string",
      flag: "",
      multiple: null,
      prefix: null,
      description: null,
    },
  },
};

const DEFAULT_ENV_CHECK: EnvironmentCheckResult = {
  is_ready: true,
  providers: [
    {
      provider_id: "dotnet",
      installed: true,
      version: "8.0.403",
      path: "/usr/local/share/dotnet/dotnet",
    },
    {
      provider_id: "cargo",
      installed: true,
      version: "1.82.0",
      path: "/Users/test/.cargo/bin/cargo",
    },
    { provider_id: "go", installed: false, version: null, path: null },
  ],
  issues: [
    {
      severity: "info",
      provider_id: "go",
      issue_type: "missing_tool",
      description: "Go is not installed",
      current_value: null,
      expected_value: ">=1.21",
      fixes: [
        {
          action_type: "open_url",
          label: "Install Go",
          command: null,
          url: "https://go.dev/dl/",
        },
      ],
    },
  ],
  checked_at: new Date().toISOString(),
};

// ─── Mock Tauri installer ───

export interface MockTauriOptions {
  /** Override default app state */
  initialState?: Partial<AppState>;
  /** Override repositories list */
  repositories?: Repository[];
  /** Override provider list */
  providers?: ProviderCatalogEntry[];
  /** Map of Tauri command name → error message to inject for testing error paths.
   * `prepare_publish_runtime` 支持 `blocked:` 前缀：返回 blocked 结果而非抛错。 */
  errors?: Record<string, string>;
  /** Value returned by `plugin:dialog|open`（目录选择）。null 表示用户取消。 */
  dialogOpenPath?: string | null;
  /** Whether to log all invoke calls to console (for debugging) */
  debug?: boolean;
}

export async function installMockTauri(
  page: Page,
  options: MockTauriOptions = {}
) {
  const {
    initialState,
    repositories,
    providers,
    errors,
    dialogOpenPath,
    debug,
  } = options;

  const clone = <T>(v: T): T =>
    (v === undefined ? undefined : JSON.parse(JSON.stringify(v))) as T;

  // Merge user overrides with defaults
  const effectiveState = {
    ...DEFAULT_APP_STATE,
    ...(initialState ?? {}),
    repositories: repositories ?? DEFAULT_REPOSITORIES,
  };
  const effectiveProviders = providers ?? DEFAULT_PROVIDERS;

  await page.addInitScript(
    (opts: Record<string, unknown>) => {
      const clone = (v: unknown) => JSON.parse(JSON.stringify(v));
      const renderMockPublishCommand = (spec?: PublishSpec) => {
        const providerId = spec?.provider_id || "dotnet";
        const parameters = spec?.parameters ?? {};
        const configuration =
          typeof parameters.configuration === "string"
            ? parameters.configuration
            : "Release";
        const output =
          typeof parameters.output === "string" ? parameters.output : null;
        const properties =
          parameters.properties && typeof parameters.properties === "object"
            ? (parameters.properties as Record<string, unknown>)
            : {};
        const publishProfile =
          typeof properties.PublishProfile === "string"
            ? properties.PublishProfile
            : null;
        const commandArgs = ["publish", "--configuration", configuration];
        let displayCommand = `${providerId} publish --configuration ${configuration}`;
        if (publishProfile) {
          commandArgs.push("--property", `PublishProfile=${publishProfile}`);
          displayCommand += ` --property PublishProfile=${publishProfile}`;
        }
        if (output) {
          commandArgs.push("--output", output);
          displayCommand += ` --output ${output}`;
        }
        return {
          program: providerId,
          args: commandArgs,
          working_dir: "/workspace/alpha-service",
          display_command: displayCommand,
          env: [],
        };
      };

      const appState = clone(opts.appState) as AppState;
      const providerList = clone(opts.providers) as ProviderCatalogEntry[];
      const dotnetSchema = clone(opts.dotnetSchema) as ParameterSchema;
      const envCheck = clone(opts.envCheck) as EnvironmentCheckResult;
      const errMap = (opts.errors ?? {}) as Record<string, string>;
      const dialogOpen = (opts.dialogOpenPath ?? null) as string | null;
      const d = (opts.debug ?? false) as boolean;

      // 后端 PublishConfigStore::default()（configuration 恒为 Release）。

      // legacy_dotnet::rich_form_from_parameters 的简化移植：把草稿参数投回
      // 旧三字段富表单视图（§4.2 过渡投影，仅服务 e2e 内存状态一致性）。

      const log = (...args: unknown[]) => {
        if (d) console.log("[mock-tauri]", ...args);
      };

      const win = window as unknown as Record<string, unknown>;

      win.__TAURI_INTERNALS__ = {
        invoke: async (cmd: string, args?: Record<string, unknown>) => {
          log("invoke:", cmd, args);

          // Error injection: throw if this command is in the errors map.
          // Special case: a `blocked:` prefix on prepare_publish_runtime
          // returns a blocked PreparedPublishRuntime instead of throwing.
          const injectedError = errMap[cmd];
          const blockedMessage =
            cmd === "prepare_publish_runtime" &&
            injectedError?.startsWith("blocked:")
              ? injectedError.slice("blocked:".length).trim()
              : null;
          if (injectedError && !blockedMessage) {
            throw new Error(injectedError);
          }

          switch (cmd) {
            // Store
            case "get_app_state":
              return clone({ ...appState, executionHistory: [] });

            case "update_publish_edit_state": {
              // §4.1 v4 统一编辑状态命令：draft 提交按 (provider, 项目候选)
              // upsert 草稿并选中草稿来源；selection 显式切换。随后按后端
              // §4.2 投影语义同步旧三字段。
              const repo = appState.repositories?.find(
                (r: Repository) => r.id === (args?.repoId as string)
              );
              const update = (args?.update ?? {}) as {
                selection?: PublishSelectionRef;
                draft?: {
                  providerId?: string;
                  projectBinding?: string | null;
                  parameters?: unknown;
                  baseRevision?: {
                    configurationId: string;
                    revisionId: string;
                  } | null;
                };
              };
              if (repo) {
                const config = repo.publishConfig;
                if (update.draft) {
                  const providerId = update.draft.providerId || "dotnet";
                  const projectBinding = update.draft.projectBinding ?? null;
                  const draft: ScopedPublishDraft = {
                    providerId,
                    projectBinding: projectBinding ?? undefined,
                    content: {
                      providerId,
                      contractVersion: 1,
                      providerVersion: "1",
                      settingsVersion: 1,
                      projectBinding: projectBinding ?? undefined,
                      parameters: clone(
                        (update.draft.parameters ?? {}) as JsonValue
                      ),
                      composition: {
                        executionBackend: {
                          adapterId: "local-execution",
                          settingsVersion: 1,
                          settings: {},
                          credentials: {},
                        },
                        artifactStore: {
                          adapterId: "temporary-artifact-store",
                          settingsVersion: 1,
                          settings: {},
                          credentials: {},
                        },
                        artifactProcessors: [],
                        deliveryRoutes: [],
                      },
                    },
                    baseRevision: update.draft.baseRevision ?? undefined,
                  };
                  const existingIndex = config.drafts.findIndex(
                    (existing) =>
                      existing.providerId === providerId &&
                      (existing.projectBinding ?? null) === projectBinding
                  );
                  if (existingIndex >= 0) {
                    config.drafts[existingIndex] = draft;
                  } else {
                    config.drafts.push(draft);
                  }
                  config.selection = {
                    kind: "draft",
                    providerId,
                    projectBinding,
                  };
                } else if (update.selection) {
                  config.selection = clone(update.selection);
                }
              }
              return clone(appState);
            }

            case "update_ui_state":
              return null;

            case "update_preferences": {
              if (args?.language) appState.language = args.language as string;
              if (args?.theme) appState.theme = args.theme as string;
              if (typeof args?.minimizeToTrayOnClose === "boolean")
                appState.minimizeToTrayOnClose =
                  args.minimizeToTrayOnClose as boolean;
              if (typeof args?.executionHistoryLimit === "number")
                appState.executionHistoryLimit =
                  args.executionHistoryLimit as number;
              return null;
            }

            // ── Provider ──
            case "list_providers":
              return clone(providerList);

            case "get_provider_schema": {
              const pid = args?.providerId as string;
              if (pid === "dotnet") return clone(dotnetSchema);
              return { parameters: {} };
            }

            case "import_from_command":
              return {
                providerId: (args?.providerId as string) || "",
                parameters: {},
                diagnostics: [],
              };

            case "get_profiles": {
              // Return profiles from the selected repo's publishConfig
              const repoId = (args?.repoId || args?.repo_id) as string;
              const repo = appState.repositories?.find(
                (r: Repository) => r.id === repoId
              );
              return clone(repo?.publishConfig?.profiles ?? []);
            }

            case "get_execution_history":
              return clone(appState.executionHistory ?? []);

            case "push_recent_publish_config": {
              const repoId = args?.repoId as string;
              const configKey = args?.configKey as string;
              const current = appState.recentConfigKeysByRepo[repoId] ?? [];
              appState.recentConfigKeysByRepo[repoId] = [
                configKey,
                ...current.filter((key) => key !== configKey),
              ];
              return clone(appState);
            }

            case "add_execution_record": {
              const record =
                args?.record as AppState["executionHistory"][number];
              appState.executionHistory = [
                record,
                ...(appState.executionHistory ?? []),
              ];
              return clone(appState.executionHistory);
            }

            case "set_execution_record_snapshot":
              return clone(appState.executionHistory ?? []);

            case "get_repository": {
              const repoId = (args?.repoId || args?.repo_id) as string;
              return clone(
                appState.repositories?.find(
                  (r: Repository) => r.id === repoId
                ) ?? null
              );
            }

            case "save_app_state":
            case "remove_repository":
            case "update_repository":
            case "reorder_repositories":
            case "save_profile":
            case "update_profile":
            case "delete_profile":
            case "remove_recent_publish_config":
            case "reorder_recent_publish_configs":
            case "reorder_profiles":
            case "replace_recent_publish_config_key":
            case "update_tray_menu":
              return null;

            case "add_repository": {
              // 与 store/commands.rs#add_repository 对齐：重复路径报
              // repository_exists（Tauri reject 序列化对象）；成功后自动
              // 选中新仓库并返回新 AppState。
              const repo = args?.repo as Repository;
              const exists = appState.repositories?.some(
                (existing) => existing.path === repo.path
              );
              if (exists) {
                throw {
                  code: "repository_exists",
                  message: "仓库已存在",
                };
              }
              appState.repositories = [...(appState.repositories ?? []), repo];
              appState.selectedRepoId = repo.id;
              return clone({ ...appState, executionHistory: [] });
            }

            // ── Repository ──
            case "scan_repository_branches": {
              // 前端契约传 path（api.ts#scanRepositoryBranches）；
              // 兼容历史 spec 直接传 repoId。未知 path 返回 main fallback，
              // 对齐 normalizeInitialBranchState 的兜底语义。
              const pathOrId = (args?.path ?? args?.repoId) as
                string | undefined;
              const repo = appState.repositories?.find(
                (r: Repository) => r.id === pathOrId || r.path === pathOrId
              );
              if (repo) {
                return {
                  branches: clone(repo.branches),
                  current_branch: repo.currentBranch,
                };
              }
              return {
                branches: [
                  {
                    name: "main",
                    isMain: true,
                    isCurrent: true,
                    path: pathOrId ?? "",
                    commitCount: 0,
                  },
                ],
                current_branch: "main",
              };
            }

            case "check_repository_branch_connectivity":
              return { canConnect: true };

            case "detect_repository_provider": {
              // 后端契约：path 存在时返回 provider id 字符串（scanner.rs）。
              const repoPath = args?.path as string | undefined;
              return repoPath ? "dotnet" : "";
            }

            case "scan_project": {
              const pf =
                (args?.projectFile as string) ||
                "/workspace/alpha-service/App.csproj";
              const rootPath = pf.replace(/\/[^/]+\.csproj$/, "");
              return {
                root_path: rootPath,
                project_file: pf,
                publish_profiles: ["FolderProfile", "ZipProfile", "WebDeploy"],
                target_frameworks: ["net8.0"],
              };
            }

            case "resolve_project_info": {
              const pf =
                (args?.projectFile as string) ||
                "/workspace/alpha-service/App.csproj";
              const rootPath = pf.replace(/\/[^/]+\.csproj$/, "");
              return {
                root_path: rootPath,
                project_file: pf,
                publish_profiles: ["FolderProfile", "ZipProfile", "WebDeploy"],
                target_frameworks: ["net8.0"],
              };
            }

            case "scan_project_candidates": {
              // 前端契约传 startPath（api.ts#scanProjectCandidates）。
              const rootPath =
                (args?.startPath as string) ||
                (args?.path as string) ||
                "/workspace/alpha-service";
              return {
                rootPath: rootPath,
                solutionFiles: [`${rootPath}/Solution.sln`],
                projectFiles: [
                  `${rootPath}/App.csproj`,
                  `${rootPath}/Tests.csproj`,
                ],
                recommendedProjectFile: `${rootPath}/App.csproj`,
              };
            }

            case "scan_project_files":
              return [];

            case "read_project_publish_profile": {
              const profileName =
                (args?.profileName as string) || "FolderProfile";
              return {
                profileName,
                filePath: `/workspace/alpha-service/Properties/PublishProfiles/${profileName}.pubxml`,
                content: `<Project><PropertyGroup><PublishDir>bin/Release/net8.0/${profileName}/</PublishDir></PropertyGroup></Project>`,
              };
            }

            // ── Publish ──
            case "prepare_publish_runtime": {
              if (blockedMessage) {
                return {
                  status: "blocked",
                  diagnostics: [
                    { code: "injected_blocked", message: blockedMessage },
                  ],
                  outputPreflight: {
                    outputDir: "/tmp/publish-output",
                    accessStatus: "granted",
                    protectedRoot: null,
                    probeDirectory: null,
                    remoteLocation: null,
                  },
                };
              }
              const request = args?.request as
                | {
                    repositoryId?: string;
                    source?: {
                      kind?: string;
                      providerId?: string;
                      configurationId?: string;
                      revisionId?: string;
                      reference?: string;
                      templateId?: string;
                      recordId?: string;
                      content?: {
                        providerId: string;
                        parameters: Record<string, unknown>;
                      };
                    };
                    runInputs?: { defaultOutputDir?: string };
                  }
                | undefined;
              const source = request?.source ?? {};
              const kind = source.kind;
              const revision =
                kind === "revision"
                  ? (source.revisionId ?? "mock-revision")
                  : "mock-draft-revision";
              const configurationId =
                kind === "revision"
                  ? (source.configurationId ?? "mock-configuration")
                  : "mock-draft-configuration";
              const providerId =
                source.content?.providerId ||
                (typeof source.providerId === "string" && source.providerId) ||
                "dotnet";
              // 按来源语义构造参数投影（与后端 build_resolved_spec 对齐）：
              // projectProfile → PublishProfile 属性；draft → 前端参数；其余默认 Release。
              const parameters =
                source.kind === "projectProfile" && source.reference
                  ? ({
                      properties: { PublishProfile: source.reference },
                    } as PublishSpec["parameters"])
                  : source.content?.parameters &&
                      typeof source.content.parameters === "object" &&
                      !Array.isArray(source.content.parameters)
                    ? (source.content.parameters as PublishSpec["parameters"])
                    : { configuration: "Release" };
              const resolvedSpec: PublishSpec = {
                version: 1,
                provider_id: providerId,
                project_path: "/workspace/alpha-service/App.csproj",
                parameters,
              };
              const defaultOutputDir =
                request?.runInputs?.defaultOutputDir || "";
              return {
                status: "ready",
                configurationId,
                configurationRevisionId: revision,
                resolvedSpec,
                command: renderMockPublishCommand(resolvedSpec),
                plan: {
                  version: 1,
                  digest: `plan-${revision}`,
                  snapshotDigest: `snapshot-${revision}`,
                  executionBackend: "local-execution",
                  nodes: [
                    {
                      id: "build",
                      stage: "build",
                      adapterId: "selected-project-provider",
                      operation: "selected-project-provider:publish",
                      cancellable: false,
                      cleanupOwnedStaging: false,
                      irreversible: false,
                    },
                    {
                      id: "persist",
                      stage: "persist_manifest",
                      adapterId: "temporary-artifact-store",
                      operation: "persist_manifest",
                      cancellable: false,
                      cleanupOwnedStaging: false,
                      irreversible: false,
                    },
                    {
                      id: "stage",
                      stage: "stage_routes",
                      adapterId: "local-directory",
                      operation: "stage_local_directory",
                      cancellable: false,
                      cleanupOwnedStaging: false,
                      irreversible: false,
                    },
                    {
                      id: "publish",
                      stage: "publish_routes",
                      adapterId: "local-directory",
                      operation: "publish_local_directory",
                      cancellable: false,
                      cleanupOwnedStaging: false,
                      irreversible: true,
                    },
                  ],
                },
                outputPreflight: {
                  outputDir: defaultOutputDir || "/tmp/publish-output",
                  accessStatus: "granted",
                  protectedRoot: null,
                  probeDirectory: null,
                  remoteLocation: null,
                },
                recoverySnapshot: {
                  version: 1,
                  content: {
                    providerId,
                    contractVersion: 1,
                    providerVersion: "1",
                    settingsVersion: 1,
                    parameters: {},
                    composition: {
                      executionBackend: {
                        adapterId: "local-execution",
                        settingsVersion: 1,
                        settings: {},
                        credentials: {},
                      },
                      artifactStore: {
                        adapterId: "temporary-artifact-store",
                        settingsVersion: 1,
                        settings: {},
                        credentials: {},
                      },
                      artifactProcessors: [],
                      deliveryRoutes: [],
                    },
                  },
                  configurationId,
                  configurationRevisionId: revision,
                  origin:
                    kind === "revision"
                      ? {
                          kind: "revision",
                          configurationId,
                          revisionId: revision,
                        }
                      : { kind: "new" },
                  runInputs: { defaultOutputDir },
                  executedParameters: {},
                  resolvedOutputDirectory:
                    defaultOutputDir || "/tmp/publish-output",
                },
                runtimeToken: `runtime-${revision}`,
              };
            }

            case "resolve_publish_source": {
              const source = args?.source as
                { providerId?: string } | undefined;
              const providerId = source?.providerId || "dotnet";
              return {
                draft: {
                  content: {
                    providerId,
                    contractVersion: 1,
                    providerVersion: "1",
                    settingsVersion: 1,
                    parameters: {},
                    composition: {
                      executionBackend: {
                        adapterId: "local-execution",
                        settingsVersion: 1,
                        settings: {},
                        credentials: {},
                      },
                      artifactStore: {
                        adapterId: "temporary-artifact-store",
                        settingsVersion: 1,
                        settings: {},
                        credentials: {},
                      },
                      artifactProcessors: [],
                      deliveryRoutes: [],
                    },
                  },
                  origin: { kind: "new" },
                  baseRevision: undefined,
                },
                configurationId: undefined,
                revisionId: undefined,
                blockedReason: undefined,
                diagnostics: [],
              };
            }

            case "start_publish_runtime": {
              const runtimeToken = (
                args?.request as { runtimeToken?: string } | undefined
              )?.runtimeToken;
              const revision =
                runtimeToken?.replace("runtime-", "") || "mock-revision";
              const manifestDigest = `manifest-${revision}`;
              return {
                attempt: {
                  attemptId: `attempt-${revision}`,
                  backendRunId: `backend-${revision}`,
                  configurationRevisionId: revision,
                  planDigest: `plan-${revision}`,
                  executionBackend: "local-execution",
                  status: "published",
                  manifestDigest,
                  manifest: { digest: manifestDigest, artifactCount: 12 },
                  receipts: [
                    {
                      version: 1,
                      receiptId: `receipt-${revision}`,
                      revision: 1,
                      routeId: "local-delivery",
                      manifestDigest,
                      status: "published",
                      externalReference: "/tmp/publish-output",
                    },
                  ],
                  routes: [
                    {
                      routeId: "local-delivery",
                      required: true,
                      status: "published",
                      externalReference: "/tmp/publish-output",
                      error: null,
                    },
                  ],
                  warnings: [],
                  events: [
                    {
                      eventId: `event-${revision}`,
                      planNodeId: "publish",
                      kind: "delivery_receipt_observed",
                      manifestDigest,
                      receiptId: `receipt-${revision}`,
                      deliveryStatus: "published",
                      receipt: {
                        version: 1,
                        receiptId: `receipt-${revision}`,
                        revision: 1,
                        routeId: "local-delivery",
                        manifestDigest,
                        status: "published",
                        externalReference: "/tmp/publish-output",
                      },
                      error: null,
                    },
                  ],
                  error: null,
                },
                publishResult: {
                  provider_id: "dotnet",
                  success: true,
                  cancelled: false,
                  error: null,
                  command: {
                    program: "dotnet",
                    args: ["publish"],
                    working_dir: "/workspace/alpha-service",
                    display_command: "dotnet publish",
                    env: [],
                  },
                  output_log:
                    "[mock] Publishing...\n[mock] Publish succeeded.\n",
                  output_dir: "/tmp/publish-output",
                  file_count: 12,
                  warnings: null,
                },
              };
            }

            case "resume_publish_runtime": {
              const attemptId =
                (args?.request as { attemptId?: string } | undefined)
                  ?.attemptId || "attempt-mock-revision";
              const revision = attemptId.replace("attempt-", "");
              return {
                attempt: {
                  attemptId,
                  backendRunId: `backend-${revision}`,
                  configurationRevisionId: revision,
                  planDigest: `plan-${revision}`,
                  executionBackend: "local-execution",
                  status: "published",
                  manifestDigest: `manifest-${revision}`,
                  manifest: {
                    digest: `manifest-${revision}`,
                    artifactCount: 12,
                  },
                  receipts: [],
                  routes: [],
                  warnings: [],
                  events: [],
                  error: null,
                },
                publishResult: null,
              };
            }

            case "synchronize_publish_runtime": {
              const request = args?.request as
                { attemptId?: string; events?: unknown[] } | undefined;
              return {
                attemptId: request?.attemptId || "attempt-mock-revision",
                acceptedEvents: request?.events?.length || 0,
                duplicateEvents: 0,
                missingRanges: [],
                result: null,
              };
            }

            case "preflight_publish_output": {
              const outputDir =
                (args?.spec &&
                typeof args.spec === "object" &&
                "parameters" in args.spec
                  ? (
                      args.spec as Record<string, Record<string, string>>
                    ).parameters?.outputDir?.toString()
                  : "") || "/tmp/publish-output";
              return {
                output_dir: outputDir,
                configured_output_dir: outputDir || null,
                validation: { status: "not_applicable", issue: null },
                access: {
                  status: "granted",
                  protectedLocation: null,
                  protectedRoot: null,
                  probeDirectory: outputDir,
                  detail: null,
                },
              };
            }

            case "cancel_publish_runtime":
              return true;

            // ── Environment ──
            case "run_environment_check":
              return clone(envCheck);

            case "apply_fix": {
              const actionType = (args?.action as Record<string, string>)
                ?.action_type;
              if (actionType === "open_url")
                return { result: "OpenedUrl", data: "https://example.com" };
              if (actionType === "run_command")
                return {
                  result: "CommandExecuted",
                  data: { stdout: "", stderr: "", exit_code: 0 },
                };
              return { result: "Manual", data: "" };
            }

            // ── Export ──
            case "export_preflight_report":
              return "/tmp/report.md";

            case "export_execution_snapshot":
              return "/tmp/snapshot.json";

            case "export_failure_group_bundle":
              return "/tmp/failure-bundle.zip";

            case "dispatch_manual_publish_run":
              return { attemptId: "e2e-manual-1", runId: 1 };

            case "cancel_remote_publish_run":
              return null;

            case "export_execution_history":
              return "/tmp/history.csv";

            case "export_diagnostics_index":
              return "/tmp/diagnostics-index.html";

            case "open_execution_snapshot":
              return "ok";

            case "open_directory":
              return "ok";

            case "open_output_directory":
              return "ok";

            // ── Config ──
            case "export_config":
              return {
                version: 1,
                exported_at: new Date().toISOString(),
                profiles: [],
              };

            case "import_config":
              return { imported: 0, skipped: 0, errors: [] };

            case "apply_imported_config":
              return null;

            // ── Artifact ──
            case "package_artifact":
              return {
                artifactPath: "/tmp/artifact.zip",
                format: "zip",
                fileCount: 1,
                bytes: 1024,
                sha256: "abc123",
              };

            case "sign_artifact":
              return {
                signaturePath: "/tmp/artifact.zip.sig",
                method: "gpg_detached",
                stdout: "",
                stderr: "",
                exitCode: 0,
                success: true,
              };

            // ── Updater ──
            case "check_update":
              return {
                current_version: "0.6.3",
                available_version: null,
                has_update: false,
                release_notes: null,
                message: null,
              };

            case "get_current_version":
              return "0.6.3";

            case "get_shortcuts_help":
              return [{ key: "Ctrl+P", description: "Publish" }];

            case "get_updater_config_health":
              return { configured: false, message: "No updater configured" };

            case "get_updater_help_paths":
              return { docsPath: "/docs", templatePath: "/template" };

            case "install_update":
              return null;

            case "open_updater_help":
              return "ok";

            // ── Notification ──
            case "show_system_notification":
              return null;

            // ── Listeners (events) ──
            case "plugin:event|listen":
              return null;

            case "plugin:event|emit":
              return null;

            // ── Dialog plugin ──
            case "plugin:dialog|open":
              return dialogOpen;

            case "plugin:dialog|ask":
              return true;

            case "plugin:dialog|message":
              return null;

            default:
              log("UNHANDLED COMMAND:", cmd);
              // Return null for unknown commands rather than throwing
              return null;
          }
        },
      };

      // indicate mocked environment
      win.isTauri = false;
    },
    {
      appState: clone(effectiveState),
      providers: clone(effectiveProviders),
      dotnetSchema: clone(DOTNET_SCHEMA),
      envCheck: clone(DEFAULT_ENV_CHECK),
      errors: clone(errors ?? {}),
      dialogOpenPath: dialogOpenPath ?? null,
      debug,
    } as unknown as Record<string, unknown>
  );
}

// ─── Navigation helpers ───

export async function gotoApp(page: Page, options: MockTauriOptions = {}) {
  await installMockTauri(page, options);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  // Wait for the app to render — the repo list is the most reliable signal
  await expect(page.locator("[data-list-item-id='repo-a']")).toBeVisible({
    timeout: 15000,
  });
}

/**
 * Navigate to app and wait for the publish config panel to appear.
 */
export async function gotoAppWithPublishConfig(
  page: Page,
  options: MockTauriOptions = {}
) {
  await gotoApp(page, options);
  // The publish config panel should show preset items
  await expect(
    page.locator("[data-list-item-id='pubxml:FolderProfile']")
  ).toBeVisible({ timeout: 10000 });
}
