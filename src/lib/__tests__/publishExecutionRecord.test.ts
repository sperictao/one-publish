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
});
