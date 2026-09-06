import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import {
  cancelPublishRuntime,
  importFromCommand,
  preparePublishRuntime,
  preflightProviderPublishOutput,
  resolvePublishSource,
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

const draftContent = {
  providerId: "dotnet",
  contractVersion: 1,
  providerVersion: "1",
  settingsVersion: 1,
  parameters: { configuration: "Release" },
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
};

describe("publishRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("centralizes source resolution, prepare, preflight, and command import invokes", async () => {
    const prepared = {
      status: "ready",
      configurationId: "draft-configuration",
      configurationRevisionId: "draft-revision",
      resolvedSpec: spec,
      command: {
        program: "dotnet",
        args: ["publish", "/repo/App.csproj"],
        working_dir: "/repo",
        display_command: "dotnet publish /repo/App.csproj",
        env: [],
      },
      plan: {
        version: 1,
        digest: "plan-draft",
        snapshotDigest: "snapshot-draft",
        executionBackend: "local-execution",
        nodes: [],
      },
      outputPreflight: {
        outputDir: "/repo/bin/Release/publish",
        accessStatus: "granted",
      },
      recoverySnapshot: {
        version: 1,
        content: {},
        configurationId: "draft-configuration",
        configurationRevisionId: "draft-revision",
        origin: { kind: "new" },
        runInputs: { defaultOutputDir: "" },
        executedParameters: {},
        resolvedOutputDirectory: "/repo/bin/Release/publish",
      },
      runtimeToken: "token-draft",
    };
    const resolved = {
      draft: {
        content: {
          providerId: "dotnet",
          contractVersion: 1,
          providerVersion: "1",
          settingsVersion: 1,
          parameters: {},
          composition: {},
        },
        origin: { kind: "new" },
      },
      diagnostics: [],
    };
    invokeMock
      .mockResolvedValueOnce(resolved)
      .mockResolvedValueOnce(prepared)
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
      .mockResolvedValueOnce(spec);

    // 统一 prepare 合同：来源解析与准备是两个独立命令。
    await expect(
      resolvePublishSource("repo-1", {
        kind: "draft",
        content: draftContent,
      })
    ).resolves.toBe(resolved);
    await expect(
      preparePublishRuntime({
        repositoryId: "repo-1",
        source: {
          kind: "draft",
          content: draftContent,
        },
        runInputs: { defaultOutputDir: "", promotedManifestDigest: undefined },
      })
    ).resolves.toBe(prepared);
    await preflightProviderPublishOutput(spec);
    await importFromCommand({
      command: "dotnet publish /repo/App.csproj",
      providerId: "dotnet",
      projectPath: "/repo/App.csproj",
    });

    expect(invokeMock).toHaveBeenNthCalledWith(1, "resolve_publish_source", {
      repositoryId: "repo-1",
      source: {
        kind: "draft",
        content: draftContent,
      },
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "prepare_publish_runtime", {
      request: {
        repositoryId: "repo-1",
        source: {
          kind: "draft",
          content: draftContent,
        },
        runInputs: { defaultOutputDir: "", promotedManifestDigest: undefined },
      },
    });
    expect(invokeMock).toHaveBeenNthCalledWith(3, "preflight_publish_output", {
      spec,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(4, "import_from_command", {
      command: "dotnet publish /repo/App.csproj",
      providerId: "dotnet",
      projectPath: "/repo/App.csproj",
    });
  });

  it("prepares and starts the sealed local publish runtime through request contracts", async () => {
    const prepared = {
      status: "ready",
      configurationId: "configuration-A",
      configurationRevisionId: "revision-A",
      resolvedSpec: spec,
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
      outputPreflight: {
        outputDir: "/repo/bin/Release/publish",
        accessStatus: "granted",
      },
      recoverySnapshot: {
        version: 1,
        content: {},
        configurationId: "configuration-A",
        configurationRevisionId: "revision-A",
        origin: {
          kind: "revision",
          configurationId: "configuration-A",
          revisionId: "revision-A",
        },
        runInputs: { defaultOutputDir: "" },
        executedParameters: {},
        resolvedOutputDirectory: "/repo/bin/Release/publish",
      },
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
      source: {
        kind: "revision" as const,
        configurationId: "configuration-A",
        revisionId: "revision-A",
      },
      runInputs: { defaultOutputDir: "", promotedManifestDigest: undefined },
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
