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
  ParameterSchema,
  PublishSpec,
  ProviderCatalogEntry,
  Repository,
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
      selectedPreset: "profile-FolderProfile",
      isCustomMode: false,
      customConfig: {
        configuration: "Release",
        runtime: "",
        framework: "",
        selfContained: false,
        outputDir: "",
        noBuild: false,
        noRestore: false,
        verbosity: "",
        noLogo: false,
        deleteExistingFiles: false,
        properties: {},
        useProfile: false,
        profileName: "",
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
      selectedPreset: "profile-FolderProfile",
      isCustomMode: false,
      customConfig: {
        configuration: "Release",
        runtime: "",
        framework: "",
        selfContained: false,
        outputDir: "",
        noBuild: false,
        noRestore: false,
        verbosity: "",
        noLogo: false,
        deleteExistingFiles: false,
        properties: {},
        useProfile: false,
        profileName: "",
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
  },
  {
    id: "go",
    display_name: "go",
    version: "1.23.0",
    label: "Go",
    command_example: "go build",
    environment_label: "go 1.23",
    environment_description: "Go toolchain 1.23.0",
    requires_project_binding: true,
    project_path_kind: "repository_root",
    supports_command_import: false,
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
  /** Map of Tauri command name → error message to inject for testing error paths */
  errors?: Record<string, string>;
  /** Whether to log all invoke calls to console (for debugging) */
  debug?: boolean;
}

export async function installMockTauri(
  page: Page,
  options: MockTauriOptions = {}
) {
  const { initialState, repositories, providers, errors, debug } = options;

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
      const d = (opts.debug ?? false) as boolean;

      const log = (...args: unknown[]) => {
        if (d) console.log("[mock-tauri]", ...args);
      };

      const win = window as unknown as Record<string, unknown>;

      win.__TAURI_INTERNALS__ = {
        invoke: async (cmd: string, args?: Record<string, unknown>) => {
          log("invoke:", cmd, args);

          // Error injection: throw if this command is in the errors map
          if (errMap[cmd]) {
            throw new Error(errMap[cmd]);
          }

          switch (cmd) {
            // Store
            case "get_app_state":
              return clone({ ...appState, executionHistory: [] });

            case "update_publish_state": {
              const repo = appState.repositories?.find(
                (r: Repository) => r.id === appState.selectedRepoId
              );
              if (repo && typeof args?.selectedPreset === "string") {
                repo.publishConfig.selectedPreset = args.selectedPreset;
              }
              if (repo && typeof args?.isCustomMode === "boolean") {
                repo.publishConfig.isCustomMode = args.isCustomMode;
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
              return null;

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
            case "add_repository":
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

            // ── Repository ──
            case "scan_repository_branches": {
              const repoId = args?.repoId as string;
              const repo = appState.repositories?.find(
                (r: Repository) => r.id === repoId
              );
              return repo
                ? {
                    branches: clone(repo.branches),
                    current_branch: repo.currentBranch,
                  }
                : { branches: [], current_branch: "" };
            }

            case "check_repository_branch_connectivity":
              return { canConnect: true };

            case "detect_repository_provider": {
              const providerId = args?.repoPath ? "dotnet" : null;
              return {
                provider_id: providerId,
                project_file: providerId
                  ? `${args?.repoPath}/App.csproj`
                  : null,
              };
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
              const rootPath =
                (args?.path as string) || "/workspace/alpha-service";
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
              const request = args?.request as
                | {
                    configurationId: string;
                    configurationRevisionId: string;
                    spec: PublishSpec;
                  }
                | undefined;
              const revision =
                request?.configurationRevisionId || "mock-revision";
              return {
                configurationId:
                  request?.configurationId || "mock-configuration",
                configurationRevisionId: revision,
                command: renderMockPublishCommand(request?.spec),
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
                      irreversible: false,
                    },
                    {
                      id: "persist",
                      stage: "persist_manifest",
                      adapterId: "temporary-artifact-store",
                      operation: "persist_manifest",
                      irreversible: false,
                    },
                    {
                      id: "stage",
                      stage: "stage_routes",
                      adapterId: "local-directory",
                      operation: "stage_local_directory",
                      irreversible: false,
                    },
                    {
                      id: "publish",
                      stage: "publish_routes",
                      adapterId: "local-directory",
                      operation: "publish_local_directory",
                      irreversible: true,
                    },
                  ],
                },
                blockedReason: null,
                runtimeToken: `runtime-${revision}`,
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

            case "render_provider_publish": {
              return renderMockPublishCommand(
                args?.spec as PublishSpec | undefined
              );
            }

            case "execute_provider_publish": {
              const execId = `exec-${Date.now()}`;
              // 先 emit 会话开始事件（与真实后端 spawn 前的 emit 对齐），
              // 再 emit 日志 chunk，保证日志捕获会话归属正确。
              const sessionStarted = new CustomEvent(
                "provider-publish-session-started",
                {
                  detail: { sessionId: execId },
                }
              );
              const publishEvent = new CustomEvent("publish-log-chunk", {
                detail: { sessionId: execId, line: "[mock] Publishing..." },
              });
              setTimeout(() => window.dispatchEvent(sessionStarted), 50);
              setTimeout(() => window.dispatchEvent(publishEvent), 100);
              setTimeout(() => {
                window.dispatchEvent(
                  new CustomEvent("publish-log-chunk", {
                    detail: {
                      sessionId: execId,
                      line: "[mock] Publish succeeded.",
                    },
                  })
                );
              }, 200);
              return {
                provider_id: (args?.providerId as string) || "dotnet",
                success: true,
                cancelled: false,
                error: null,
                command: {
                  program: "dotnet",
                  args: ["publish"],
                  working_dir: "/workspace/alpha-service",
                  display_command: "dotnet publish",
                },
                output_log: "[mock] Publishing...\n[mock] Publish succeeded.\n",
                output_dir: "/tmp/publish-output",
                file_count: 12,
              };
            }

            case "cancel_provider_publish":
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
