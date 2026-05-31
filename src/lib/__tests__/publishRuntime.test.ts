import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import {
  cancelProviderPublish,
  executeProviderPublish,
  importProviderPublishSpecFromCommand,
  preflightProviderPublishOutput,
  renderProviderPublish,
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
});
