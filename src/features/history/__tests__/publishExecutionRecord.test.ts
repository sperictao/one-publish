import { describe, expect, it } from "vitest";

import { createPublishExecutionRecord } from "@/features/history/publishExecutionRecord";

function createCommand(displayCommand = "dotnet publish /repo/App.csproj") {
  return {
    program: "dotnet",
    args: ["publish", "/repo/App.csproj"],
    working_dir: "/repo",
    display_command: displayCommand,
    env: [],
  };
}

describe("createPublishExecutionRecord", () => {
  it("固定手动发布使用的配置身份与修订，未提供时保持 legacy null", () => {
    const baseParams = {
      spec: {
        version: 1,
        provider_id: "dotnet",
        project_path: "/repo/App.csproj",
        parameters: {},
      },
      repoId: "repo-1",
      startedAt: "2026-07-21T10:00:00.000Z",
      finishedAt: "2026-07-21T10:00:03.000Z",
      result: {
        provider_id: "dotnet",
        success: true,
        cancelled: false,
        error: null,
        command: createCommand(),
        output_log: "build ok",
        output_dir: "/repo/out",
        file_count: 2,
        warnings: null,
      },
      outputLog: "build ok",
    };

    expect(
      createPublishExecutionRecord({
        ...baseParams,
        configurationId: "profile-42",
        configurationRevisionId: "revision-7",
      })
    ).toMatchObject({
      configurationId: "profile-42",
      configurationRevisionId: "revision-7",
    });
    expect(createPublishExecutionRecord(baseParams)).toMatchObject({
      configurationId: null,
      configurationRevisionId: null,
    });
  });

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
        warnings: null,
      },
      outputLog: "$ dotnet publish /repo/App.csproj\nbuild ok",
    });

    expect(record.commandLine).toBe(
      '$ dotnet publish "/repo/App.csproj" -c Release'
    );
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
        warnings: null,
      },
      outputLog:
        "$ dotnet publish /repo/App.csproj\n[stderr] Build failed: boom",
    });

    expect(record.commandLine).toBe("$ dotnet publish /repo/App.csproj");
    expect(record.failureSignature).toBe("[stderr] build failed: boom");
    expect(record.outputExcerpt).toBe(
      "$ dotnet publish /repo/App.csproj\n[stderr] Build failed: boom"
    );
  });

  it("后端命令缺失或为空时从输出日志提取 $ 行，均无则 null", () => {
    const baseParams = {
      spec: {
        version: 1 as const,
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
        command: null,
        output_log: "restoring…",
        output_dir: "/repo/out",
        file_count: 0,
        warnings: null,
      },
      outputLog: "restoring…\n$ dotnet publish -c Release\nbuild ok",
    };

    // command 为 null：扫描输出日志的首个 "$ " 行。
    expect(createPublishExecutionRecord(baseParams).commandLine).toBe(
      "$ dotnet publish -c Release"
    );

    // display_command 仅有空白同样回落到日志扫描。
    expect(
      createPublishExecutionRecord({
        ...baseParams,
        result: { ...baseParams.result, command: createCommand("   ") },
      }).commandLine
    ).toBe("$ dotnet publish -c Release");

    // 日志中没有 "$ " 行时保持 null。
    expect(
      createPublishExecutionRecord({
        ...baseParams,
        outputLog: "restoring…\nbuild ok",
      }).commandLine
    ).toBeNull();

    // 日志整体为空时立即返回 null。
    expect(
      createPublishExecutionRecord({ ...baseParams, outputLog: "" }).commandLine
    ).toBeNull();
  });

  it("空输出日志不产生失败摘录", () => {
    const record = createPublishExecutionRecord({
      spec: null,
      providerId: "dotnet",
      repoId: "repo-1",
      startedAt: "2026-03-28T10:00:00.000Z",
      finishedAt: "2026-03-28T10:00:03.000Z",
      result: {
        provider_id: "dotnet",
        success: false,
        cancelled: false,
        error: "spawn dotnet failed",
        command: null,
        output_log: "",
        output_dir: "",
        file_count: 0,
        warnings: null,
      },
      outputLog: "   ",
    });

    expect(record.outputExcerpt).toBeNull();
  });

  it("超长输出摘录按行数与字符数双上限保留尾部", () => {
    const longLines = Array.from(
      { length: 50 },
      (_, index) => `line-${index} ${"x".repeat(500)}`
    );
    const record = createPublishExecutionRecord({
      spec: null,
      providerId: "dotnet",
      repoId: "repo-1",
      startedAt: "2026-03-28T10:00:00.000Z",
      finishedAt: "2026-03-28T10:00:03.000Z",
      result: {
        provider_id: "dotnet",
        success: false,
        cancelled: false,
        error: "build failed",
        command: null,
        output_log: longLines.join("\n"),
        output_dir: "",
        file_count: 0,
        warnings: null,
      },
      outputLog: longLines.join("\n"),
    });

    const excerpt = record.outputExcerpt ?? "";
    // 40 行上限：line-0 ~ line-9 被裁掉；
    // 16 000 字符上限在 40 行 ~25k 内容里继续截尾。
    expect(excerpt).not.toContain("line-9 ");
    expect(excerpt).toContain("line-49");
    expect(excerpt.split("\n").length).toBeLessThanOrEqual(40);
    expect(excerpt.length).toBeLessThanOrEqual(16_000);
  });

  it("spec 缺失时回落 providerId、projectPath 留空且 spec 序列化为 null", () => {
    const record = createPublishExecutionRecord({
      spec: null,
      providerId: "go",
      repoId: null,
      startedAt: "2026-03-28T10:00:00.000Z",
      finishedAt: "2026-03-28T10:00:03.000Z",
      result: {
        provider_id: "go",
        success: true,
        cancelled: false,
        error: null,
        command: createCommand("go build ./..."),
        output_log: "$ go build ./...",
        output_dir: "/repo/bin",
        file_count: 1,
        warnings: null,
      },
      outputLog: "$ go build ./...",
    });

    // 准备早期失败的记录没有 spec——providerId 只能来自来源回退，
    // projectPath 无法推导时保持空串，spec 必须存 null 而非 undefined。
    expect(record.providerId).toBe("go");
    expect(record.projectPath).toBe("");
    expect(record.spec).toBeNull();
    expect(record.repoId).toBeNull();
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
        warnings: null,
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
