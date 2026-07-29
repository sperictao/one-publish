import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import {
  cancelPublishRuntime,
  cancelProviderPublish,
  executeProviderPublish,
  importProviderPublishSpecFromCommand,
  preparePublishRuntime,
  preflightProviderPublishOutput,
  renderProviderPublish,
  resumePublishRuntime,
  startPublishRuntime,
  synchronizePublishRuntime,
  type ProviderPublishSpec,
} from "@/features/publish/publishRuntime";

const spec: ProviderPublishSpec = {
  version: 1,
  provider_id: "dotnet",
  project_path: "/repo/App.csproj",
  parameters: {
    configuration: "Release",
  },
};

describe("publishRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("executes provider publish through the publish runtime boundary", async () => {
    const result = {
      provider_id: "dotnet",
      success: true,
      cancelled: false,
      error: null,
      command: {
        program: "dotnet",
        args: ["publish", "/repo/App.csproj"],
        working_dir: "/repo",
        display_command: "dotnet publish /repo/App.csproj",
      },
      output_log: "Build succeeded.",
      output_dir: "/repo/bin/Release/publish",
      file_count: 2,
    };
    invokeMock.mockResolvedValue(result);

    await expect(executeProviderPublish(spec)).resolves.toBe(result);
    expect(invokeMock).toHaveBeenCalledWith("execute_provider_publish", {
      spec,
    });
  });

  it("centralizes render, preflight, cancel, and command import invokes", async () => {
    invokeMock
      .mockResolvedValueOnce({
        program: "dotnet",
        args: ["publish", "/repo/App.csproj"],
        working_dir: "/repo",
        display_command: "dotnet publish /repo/App.csproj",
      })
      .mockResolvedValueOnce({
        outputDir: "/repo/bin/Release/publish",
        configuredOutputDir: null,
        validation: {
          status: "compatible",
          issue: null,
        },
        access: {
          status: "not_applicable",
          protectedLocation: null,
          protectedRoot: null,
          probeDirectory: null,
          detail: null,
        },
      })
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(spec);

    await renderProviderPublish(spec);
    await preflightProviderPublishOutput(spec);
    await cancelProviderPublish();
    await importProviderPublishSpecFromCommand({
      command: "dotnet publish /repo/App.csproj",
      providerId: "dotnet",
      projectPath: "/repo/App.csproj",
    });

    expect(invokeMock).toHaveBeenNthCalledWith(1, "render_provider_publish", {
      spec,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "preflight_publish_output", {
      spec,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(3, "cancel_provider_publish");
    expect(invokeMock).toHaveBeenNthCalledWith(4, "import_from_command", {
      command: "dotnet publish /repo/App.csproj",
      providerId: "dotnet",
      projectPath: "/repo/App.csproj",
    });
  });

  it("prepares and starts the sealed local publish runtime through request contracts", async () => {
    const prepared = {
      configurationId: "configuration-A",
      configurationRevisionId: "revision-A",
      command: {
        program: "dotnet",
        args: ["publish", "/repo/App.csproj"],
        working_dir: "/repo",
        display_command: "dotnet publish /repo/App.csproj",
        env: [],
      },
      plan: {
        version: 1,
        digest: "plan-A",
        snapshotDigest: "snapshot-A",
        executionBackend: "local-execution",
        nodes: [],
      },
      blockedReason: null,
      runtimeToken: "sealed-runtime-A",
    };
    const started = {
      attempt: {
        attemptId: "attempt-A",
        backendRunId: "backend-run-A",
        configurationRevisionId: "revision-A",
        planDigest: "plan-A",
        executionBackend: "local-execution",
        status: "published",
        manifestDigest: "manifest-A",
        manifest: { digest: "manifest-A", artifactCount: 2 },
        receipts: [],
        events: [],
        error: null,
      },
      publishResult: null,
    };
    invokeMock.mockResolvedValueOnce(prepared).mockResolvedValueOnce(started);

    const prepareRequest = {
      repositoryId: "repository-A",
      repositoryPath: "/repo",
      configurationId: "configuration-A",
      configurationRevisionId: "revision-A",
      spec,
    };
    await expect(preparePublishRuntime(prepareRequest)).resolves.toBe(prepared);
    await expect(
      startPublishRuntime({ runtimeToken: prepared.runtimeToken })
    ).resolves.toBe(started);

    expect(invokeMock).toHaveBeenNthCalledWith(1, "prepare_publish_runtime", {
      request: prepareRequest,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "start_publish_runtime", {
      request: { runtimeToken: "sealed-runtime-A" },
    });
  });

  it("routes resume, synchronize, and runtime cancellation through their public commands", async () => {
    const resumed = {
      attempt: { attemptId: "attempt-A" },
      publishResult: null,
    };
    const synchronized = {
      attemptId: "attempt-A",
      acceptedEvents: 0,
      duplicateEvents: 0,
      missingRanges: [],
      result: resumed,
    };
    invokeMock
      .mockResolvedValueOnce(resumed)
      .mockResolvedValueOnce(synchronized)
      .mockResolvedValueOnce(true);

    await expect(
      resumePublishRuntime({ attemptId: "attempt-A" })
    ).resolves.toBe(resumed);
    await expect(
      synchronizePublishRuntime({
        repositoryPath: "/repo",
        configurationRevisionId: "revision-A",
        events: [],
      })
    ).resolves.toBe(synchronized);
    await expect(
      cancelPublishRuntime({ runtimeToken: "sealed-runtime-A" })
    ).resolves.toBe(true);

    expect(invokeMock).toHaveBeenNthCalledWith(1, "resume_publish_runtime", {
      request: { attemptId: "attempt-A" },
    });
    expect(invokeMock).toHaveBeenNthCalledWith(
      2,
      "synchronize_publish_runtime",
      {
        request: {
          repositoryPath: "/repo",
          configurationRevisionId: "revision-A",
          events: [],
        },
      }
    );
    expect(invokeMock).toHaveBeenNthCalledWith(3, "cancel_publish_runtime", {
      request: { runtimeToken: "sealed-runtime-A" },
    });
  });
});
