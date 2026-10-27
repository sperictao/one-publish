/**
 * 08-contracts-smoke — Runtime contract drift detection.
 *
 * Verifies that the mock Tauri layer returns responses whose shape is
 * compatible with the generated TypeScript contracts.  If the backend
 * changes a field name or type, this test catches it before E2E tests
 * silently pass with stale mock data.
 *
 * Strategy: for each high-traffic Tauri command, call it via page.evaluate
 * and verify the response has the expected keys/types.
 */
import { test, expect } from "@playwright/test";
import { installMockTauri } from "../fixtures/mock-tauri";

test.describe("Contract Drift Detection", () => {
  test.beforeEach(async ({ page }) => {
    await installMockTauri(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
  });

  /**
   * Helper: invoke a Tauri command and return its result.
   */
  async function invoke(
    page: import("@playwright/test").Page,
    cmd: string,
    args?: Record<string, unknown>
  ) {
    return page.evaluate(
      async ({ cmd, args }) => {
        const win = window as unknown as {
          __TAURI_INTERNALS__?: {
            invoke: (
              c: string,
              a?: Record<string, unknown>
            ) => Promise<unknown>;
          };
        };
        if (!win.__TAURI_INTERNALS__?.invoke) {
          throw new Error("Mock Tauri not installed");
        }
        return win.__TAURI_INTERNALS__.invoke(cmd, args);
      },
      { cmd, args }
    );
  }

  test("get_app_state returns valid AppState shape", async ({ page }) => {
    const state = (await invoke(page, "get_app_state")) as Record<
      string,
      unknown
    >;

    // Required top-level fields from AppState
    expect(state).toHaveProperty("repositories");
    expect(state).toHaveProperty("selectedRepoId");
    expect(state).toHaveProperty("leftPanelWidth");
    expect(state).toHaveProperty("theme");
    expect(state).toHaveProperty("language");
    expect(state).toHaveProperty("executionHistory");

    // repositories should be an array
    expect(Array.isArray(state.repositories)).toBe(true);

    // Each repository should have required fields
    const repos = state.repositories as Array<Record<string, unknown>>;
    if (repos.length > 0) {
      const repo = repos[0];
      expect(repo).toHaveProperty("id");
      expect(repo).toHaveProperty("name");
      expect(repo).toHaveProperty("path");
      expect(repo).toHaveProperty("currentBranch");
      expect(repo).toHaveProperty("providerId");
      expect(repo).toHaveProperty("publishConfig");
    }
  });

  test("list_providers returns valid ProviderCatalogEntry shape", async ({
    page,
  }) => {
    const providers = (await invoke(page, "list_providers")) as Array<
      Record<string, unknown>
    >;

    expect(Array.isArray(providers)).toBe(true);
    expect(providers.length).toBeGreaterThan(0);

    const p = providers[0];
    expect(p).toHaveProperty("id");
    expect(p).toHaveProperty("display_name");
    expect(p).toHaveProperty("label");
    expect(p).toHaveProperty("version");
    expect(typeof p.id).toBe("string");
  });

  test("get_provider_schema returns valid ParameterSchema shape", async ({
    page,
  }) => {
    const schema = (await invoke(page, "get_provider_schema", {
      providerId: "dotnet",
    })) as Record<string, unknown>;

    expect(schema).toHaveProperty("parameters");
    const params = schema.parameters as Record<string, unknown>;
    // dotnet schema should have common parameters
    expect(params).toHaveProperty("configuration");
    expect(params).toHaveProperty("runtime");
  });

  test("prepare_publish_runtime returns valid PreparedPublishRuntime shape", async ({
    page,
  }) => {
    const prepared = (await invoke(page, "prepare_publish_runtime", {
      request: {
        repositoryId: "repo-a",
        source: {
          kind: "draft",
          providerId: "dotnet",
          parameters: { configuration: "Release" },
        },
        runInputs: { defaultOutputDir: "" },
      },
    })) as Record<string, unknown>;

    expect(prepared).toHaveProperty("status", "ready");
    expect(prepared).toHaveProperty("configurationId");
    expect(prepared).toHaveProperty("configurationRevisionId");
    expect(prepared).toHaveProperty("resolvedSpec");
    expect(prepared).toHaveProperty("command");
    expect(prepared).toHaveProperty("plan");
    expect(prepared).toHaveProperty("outputPreflight");
    expect(prepared).toHaveProperty("recoverySnapshot");
    expect(prepared).toHaveProperty("runtimeToken");
    const command = prepared.command as Record<string, unknown>;
    expect(command).toHaveProperty("program");
    expect(command).toHaveProperty("args");
    expect(command).toHaveProperty("display_command");
    expect(typeof command.program).toBe("string");
    expect(Array.isArray(command.args)).toBe(true);
  });

  test("resolve_publish_source returns draft-shaped ResolvedPublishSource", async ({
    page,
  }) => {
    const resolved = (await invoke(page, "resolve_publish_source", {
      repositoryId: "repo-a",
      source: {
        kind: "draft",
        providerId: "dotnet",
        parameters: { configuration: "Release" },
      },
    })) as Record<string, unknown>;

    expect(resolved).toHaveProperty("draft");
    expect(resolved).toHaveProperty("diagnostics");
    const draft = resolved.draft as Record<string, unknown>;
    expect(draft).toHaveProperty("content");
    expect(draft).toHaveProperty("origin");
  });

  test("run_environment_check returns valid EnvironmentCheckResult shape", async ({
    page,
  }) => {
    const result = (await invoke(page, "run_environment_check")) as Record<
      string,
      unknown
    >;

    expect(result).toHaveProperty("is_ready");
    expect(result).toHaveProperty("providers");
    expect(result).toHaveProperty("issues");
    expect(result).toHaveProperty("checked_at");
    expect(typeof result.is_ready).toBe("boolean");
    expect(Array.isArray(result.providers)).toBe(true);
  });

  test("scan_repository_branches returns valid BranchScanResult shape", async ({
    page,
  }) => {
    const result = (await invoke(page, "scan_repository_branches", {
      repoId: "repo-a",
    })) as Record<string, unknown>;

    expect(result).toHaveProperty("branches");
    expect(result).toHaveProperty("current_branch");
    expect(Array.isArray(result.branches)).toBe(true);
  });

  test("start_publish_runtime returns valid PublishRuntimeResult shape", async ({
    page,
  }) => {
    const runtime = (await invoke(page, "start_publish_runtime", {
      request: { runtimeToken: "runtime-smoke-revision" },
    })) as Record<string, unknown>;

    expect(runtime).toHaveProperty("attempt");
    expect(runtime).toHaveProperty("publishResult");
    const attempt = runtime.attempt as Record<string, unknown>;
    expect(attempt).toHaveProperty("attemptId");
    expect(attempt).toHaveProperty("status");
    expect(attempt).toHaveProperty("routes");
    expect(attempt).toHaveProperty("receipts");
    expect(attempt).toHaveProperty("events");

    const result = runtime.publishResult as Record<string, unknown>;
    // PublishResult contract fields
    expect(result).toHaveProperty("provider_id");
    expect(result).toHaveProperty("success");
    expect(result).toHaveProperty("cancelled");
    expect(result).toHaveProperty("error");
    expect(result).toHaveProperty("command");
    expect(result).toHaveProperty("output_log");
    expect(result).toHaveProperty("output_dir");
    expect(result).toHaveProperty("file_count");

    // command sub-shape
    const command = result.command as Record<string, unknown>;
    expect(command).toHaveProperty("program");
    expect(command).toHaveProperty("args");
    expect(command).toHaveProperty("display_command");
  });

  test("error injection works and throws with correct shape", async ({
    page,
  }) => {
    // Re-install with error injection
    await installMockTauri(page, {
      errors: { update_publish_edit_state: "injected test error" },
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    // This should throw
    const error = await page.evaluate(async () => {
      const win = window as unknown as {
        __TAURI_INTERNALS__?: {
          invoke: (c: string, a?: Record<string, unknown>) => Promise<unknown>;
        };
      };
      try {
        await win.__TAURI_INTERNALS__!.invoke("update_publish_edit_state", {
          repoId: "repo-1",
          update: {},
        });
        return null;
      } catch (e) {
        return (e as Error).message;
      }
    });

    expect(error).toBe("injected test error");
  });

  test("list_publish_adapter_catalog returns valid PublishAdapterCatalog shape", async ({
    page,
  }) => {
    const catalog = (await invoke(
      page,
      "list_publish_adapter_catalog"
    )) as Record<string, unknown>;

    // builtin_adapter_catalog（publish_runtime.rs）：camelCase 契约
    expect(catalog).toHaveProperty("executionBackends");
    expect(catalog).toHaveProperty("artifactStores");
    expect(catalog).toHaveProperty("artifactProcessors");
    expect(catalog).toHaveProperty("deliveryDestinations");
    expect(catalog.executionBackends).toContain("local-execution");
    expect(catalog.deliveryDestinations).toContain("local-directory");
  });

  test("describe_publish_output_target parses local and remote targets", async ({
    page,
  }) => {
    const local = (await invoke(page, "describe_publish_output_target", {
      raw: "/workspace/dist",
    })) as Record<string, unknown>;
    expect(local.kind).toBe("local");
    expect(local.path).toBe("/workspace/dist");
    expect(local.raw).toBe("/workspace/dist");

    const remote = (await invoke(page, "describe_publish_output_target", {
      raw: "sftp://example.com/releases",
    })) as Record<string, unknown>;
    expect(remote.kind).toBe("remote");
    expect(remote.scheme).toBe("sftp");
    expect(remote.host).toBe("example.com");
  });

  test("release-settings commands reject non-tauri providers with contract errors", async ({
    page,
  }) => {
    // release_settings_provider_unsupported 属前端分支的错误码契约
    for (const cmd of [
      "load_release_settings_draft",
      "update_profile_release_settings",
    ]) {
      const error = await page.evaluate(async (command) => {
        const win = window as unknown as {
          __TAURI_INTERNALS__?: {
            invoke: (
              c: string,
              a?: Record<string, unknown>
            ) => Promise<unknown>;
          };
        };
        try {
          await win.__TAURI_INTERNALS__!.invoke(command, {
            repoId: "repo-a",
            profileId: "profile-folder",
            settings: {},
          });
          return null;
        } catch (e) {
          return (e as { code?: string }).code ?? String(e);
        }
      }, cmd);
      expect(error).toBe("release_settings_provider_unsupported");
    }
  });

  test("rebind_profile_project reports unknown profiles with contract error", async ({
    page,
  }) => {
    const error = await page.evaluate(async () => {
      const win = window as unknown as {
        __TAURI_INTERNALS__?: {
          invoke: (c: string, a?: Record<string, unknown>) => Promise<unknown>;
        };
      };
      try {
        await win.__TAURI_INTERNALS__!.invoke("rebind_profile_project", {
          repoId: "repo-a",
          profileId: "profile-missing",
        });
        return null;
      } catch (e) {
        return (e as { code?: string }).code ?? String(e);
      }
    });
    expect(error).toBe("profile_not_found");
  });

  test("synchronize_remote_publish_evidence returns RemoteAttemptEvidenceView array", async ({
    page,
  }) => {
    const evidence = await invoke(page, "synchronize_remote_publish_evidence", {
      repoId: "repo-a",
    });
    expect(Array.isArray(evidence)).toBe(true);
  });
});
