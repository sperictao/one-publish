import { describe, expect, it } from "vitest";

import { createPublishExecutionRecord } from "@/lib/publishExecutionRecord";

function createCommand(displayCommand = "dotnet publish /repo/App.csproj") {
  return {
    program: "dotnet",
    args: ["publish", "/repo/App.csproj"],
    working_dir: "/repo",
    display_command: displayCommand,
  };
}

describe("createPublishExecutionRecord", () => {
  it("优先使用后端返回的命令行", () => {
    const record = createPublishExecutionRecord({
      spec: {
        version: 1,
        provider_id: "dotnet",
        project_path: "/repo/App.csproj",
        parameters: {},
      },
      repoId: "repo-1",
      startedAt: "2026-03-28T10:00:00.000Z",
      finishedAt: "2026-03-28T10:00:03.000Z",
      result: {
        provider_id: "dotnet",
        success: true,
        cancelled: false,
        error: null,
        command: createCommand('dotnet publish "/repo/App.csproj" -c Release'),
        output_log: '$ dotnet publish "/repo/App.csproj" -c Release\nbuild ok',
        output_dir: "/repo/out",
        file_count: 2,
      },
      outputLog: "$ dotnet publish /repo/App.csproj\nbuild ok",
    });

    expect(record.commandLine).toBe('$ dotnet publish "/repo/App.csproj" -c Release');
    expect(record.failureSignature).toBeNull();
  });

  it("失败时继续根据输出日志生成失败签名", () => {
    const record = createPublishExecutionRecord({
      spec: {
        version: 1,
        provider_id: "dotnet",
        project_path: "/repo/App.csproj",
        parameters: {},
      },
      repoId: "repo-1",
      startedAt: "2026-03-28T10:00:00.000Z",
      finishedAt: "2026-03-28T10:00:03.000Z",
      result: {
        provider_id: "dotnet",
        success: false,
        cancelled: false,
        error: null,
        command: createCommand(),
        output_log:
          "$ dotnet publish /repo/App.csproj\n[stderr] Build failed: boom",
        output_dir: "",
        file_count: 0,
      },
      outputLog: "$ dotnet publish /repo/App.csproj\n[stderr] Build failed: boom",
    });

    expect(record.commandLine).toBe("$ dotnet publish /repo/App.csproj");
    expect(record.failureSignature).toBe("[stderr] build failed: boom");
    expect(record.outputExcerpt).toBe(
      "$ dotnet publish /repo/App.csproj\n[stderr] Build failed: boom"
    );
  });

  it("失败摘要只有退出码时，优先保存输出日志里的真实错误", () => {
    const record = createPublishExecutionRecord({
      spec: {
        version: 1,
        provider_id: "dotnet",
        project_path: "/repo/App.csproj",
        parameters: {},
      },
      repoId: "repo-1",
      startedAt: "2026-03-28T10:00:00.000Z",
      finishedAt: "2026-03-28T10:00:03.000Z",
      result: {
        provider_id: "dotnet",
        success: false,
        cancelled: false,
        error:
          "[stderr] CSC : error CS0246: The type or namespace name 'Foo' could not be found",
        command: createCommand(),
        output_log: [
          "$ dotnet publish /repo/App.csproj",
          "[stderr] CSC : error CS0246: The type or namespace name 'Foo' could not be found",
          "[stderr] Build FAILED.",
        ].join("\n"),
        output_dir: "",
        file_count: 0,
      },
      outputLog: [
        "$ dotnet publish /repo/App.csproj",
        "[stderr] CSC : error CS0246: The type or namespace name 'Foo' could not be found",
        "[stderr] Build FAILED.",
      ].join("\n"),
    });

    expect(record.error).toBe(
      "[stderr] CSC : error CS0246: The type or namespace name 'Foo' could not be found"
    );
    expect(record.failureSignature).toBe(
      "[stderr] csc : error cs0246: the type or namespace name <value> could not be found"
    );
  });
});
