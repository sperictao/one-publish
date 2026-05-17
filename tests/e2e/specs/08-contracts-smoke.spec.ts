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
  async function invoke(page: import("@playwright/test").Page, cmd: string, args?: Record<string, unknown>) {
    return page.evaluate(
      async ({ cmd, args }) => {
        const win = window as unknown as { __TAURI_INTERNALS__?: { invoke: (c: string, a?: Record<string, unknown>) => Promise<unknown> } };
        if (!win.__TAURI_INTERNALS__?.invoke) {
          throw new Error("Mock Tauri not installed");
        }
        return win.__TAURI_INTERNALS__.invoke(cmd, args);
      },
      { cmd, args },
    );
  }

  test("get_app_state returns valid AppState shape", async ({ page }) => {
    const state = (await invoke(page, "get_app_state")) as Record<string, unknown>;

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

  test("list_providers returns valid ProviderCatalogEntry shape", async ({ page }) => {
    const providers = (await invoke(page, "list_providers")) as Array<Record<string, unknown>>;

    expect(Array.isArray(providers)).toBe(true);
    expect(providers.length).toBeGreaterThan(0);

    const p = providers[0];
    expect(p).toHaveProperty("id");
    expect(p).toHaveProperty("display_name");
    expect(p).toHaveProperty("label");
    expect(p).toHaveProperty("version");
    expect(typeof p.id).toBe("string");
  });

  test("get_provider_schema returns valid ParameterSchema shape", async ({ page }) => {
    const schema = (await invoke(page, "get_provider_schema", { providerId: "dotnet" })) as Record<string, unknown>;

    expect(schema).toHaveProperty("parameters");
    const params = schema.parameters as Record<string, unknown>;
    // dotnet schema should have common parameters
    expect(params).toHaveProperty("configuration");
    expect(params).toHaveProperty("runtime");
  });

  test("render_provider_publish returns valid RenderedPublishCommand shape", async ({ page }) => {
    const cmd = (await invoke(page, "render_provider_publish", {
      providerId: "dotnet",
      spec: { parameters: { configuration: "Release" } },
      projectPath: "/workspace/alpha-service",
    })) as Record<string, unknown>;

    expect(cmd).toHaveProperty("program");
    expect(cmd).toHaveProperty("args");
    expect(cmd).toHaveProperty("display_command");
    expect(typeof cmd.program).toBe("string");
    expect(Array.isArray(cmd.args)).toBe(true);
  });

  test("run_environment_check returns valid EnvironmentCheckResult shape", async ({ page }) => {
    const result = (await invoke(page, "run_environment_check")) as Record<string, unknown>;

    expect(result).toHaveProperty("is_ready");
    expect(result).toHaveProperty("providers");
    expect(result).toHaveProperty("issues");
    expect(result).toHaveProperty("checked_at");
    expect(typeof result.is_ready).toBe("boolean");
    expect(Array.isArray(result.providers)).toBe(true);
  });

  test("scan_repository_branches returns valid BranchScanResult shape", async ({ page }) => {
    const result = (await invoke(page, "scan_repository_branches", {
      repoId: "repo-a",
    })) as Record<string, unknown>;

    expect(result).toHaveProperty("branches");
    expect(result).toHaveProperty("current_branch");
    expect(Array.isArray(result.branches)).toBe(true);
  });

  test("execute_provider_publish returns valid PublishResult shape", async ({ page }) => {
    const result = (await invoke(page, "execute_provider_publish", {
      providerId: "dotnet",
      spec: { parameters: {} },
      projectPath: "/workspace/alpha-service",
    })) as Record<string, unknown>;

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

  test("error injection works and throws with correct shape", async ({ page }) => {
    // Re-install with error injection
    await installMockTauri(page, {
      errors: { update_publish_state: "injected test error" },
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    // This should throw
    const error = await page.evaluate(async () => {
      const win = window as unknown as { __TAURI_INTERNALS__?: { invoke: (c: string, a?: Record<string, unknown>) => Promise<unknown> } };
      try {
        await win.__TAURI_INTERNALS__!.invoke("update_publish_state", { selectedPreset: "test" });
        return null;
      } catch (e) {
        return (e as Error).message;
      }
    });

    expect(error).toBe("injected test error");
  });
});
