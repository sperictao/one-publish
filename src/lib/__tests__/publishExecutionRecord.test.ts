import { describe, expect, it } from "vitest";

import { createPublishExecutionRecord } from "@/lib/publishExecutionRecord";

describe("createPublishExecutionRecord", () => {
  it("从输出日志中提取命令行", () => {
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
        output_dir: "/repo/out",
        file_count: 2,
      },
      outputLog: "$ dotnet publish /repo/App.csproj\nbuild ok",
    });

    expect(record.commandLine).toBe("$ dotnet publish /repo/App.csproj");
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
        output_dir: "",
        file_count: 0,
      },
      outputLog: "$ dotnet publish /repo/App.csproj\n[stderr] Build failed: boom",
    });

    expect(record.commandLine).toBe("$ dotnet publish /repo/App.csproj");
    expect(record.failureSignature).toBe("[stderr] build failed: boom");
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
