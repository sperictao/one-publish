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

/** 扫描 UTF-16 码元，判断字符串里是否存在未配对的代理项。 */
function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        index += 1;
        continue;
      }
      return true;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function createFailedRecord(outputLog: string) {
  return createPublishExecutionRecord({
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
      command: createCommand("dotnet publish"),
      output_log: outputLog,
      output_dir: "",
      file_count: 0,
      warnings: null,
    },
    outputLog,
  });
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

  it("display_command 仅有空白时从输出日志提取 $ 行，均无则 null", () => {
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
        command: createCommand("   "),
        output_log: "restoring…",
        output_dir: "/repo/out",
        file_count: 0,
        warnings: null,
      },
      outputLog: "restoring…\n$ dotnet publish -c Release\nbuild ok",
    };

    // display_command 为空白串：扫描输出日志的首个 "$ " 行。
    expect(createPublishExecutionRecord(baseParams).commandLine).toBe(
      "$ dotnet publish -c Release"
    );

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

  it("Windows CRLF 日志提取 $ 行时不会把行尾 \\r 带进 commandLine", () => {
    const crlfLog = [
      "restoring…",
      "$ dotnet publish /repo/App.csproj -c Release",
      "build ok",
    ].join("\r\n");
    const record = createPublishExecutionRecord({
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
        command: createCommand("   "),
        output_log: crlfLog,
        output_dir: "/repo/out",
        file_count: 2,
        warnings: null,
      },
      outputLog: crlfLog,
    });

    // display_command 为空白 → 回退到日志扫描；CRLF 时行尾 \r 不应残留，
    // 否则持久化的 commandLine 会污染交接片段与诊断导出。
    expect(record.commandLine).toBe(
      "$ dotnet publish /repo/App.csproj -c Release"
    );
  });

  it("CRLF 失败日志的输出摘录同样不残留 \\r，且与 commandLine 归一方式一致", () => {
    const crlfLog = [
      "$ dotnet publish /repo/App.csproj",
      "[stderr] Build failed: boom",
    ].join("\r\n");
    const record = createPublishExecutionRecord({
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
        success: false,
        cancelled: false,
        error: null,
        command: createCommand("   "),
        output_log: crlfLog,
        output_dir: "",
        file_count: 0,
        warnings: null,
      },
      outputLog: crlfLog,
    });

    expect(record.commandLine).toBe("$ dotnet publish /repo/App.csproj");
    expect(record.outputExcerpt).toBe(
      "$ dotnet publish /repo/App.csproj\n[stderr] Build failed: boom"
    );
    expect(record.failureSignature).toBe("[stderr] build failed: boom");
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
        command: createCommand(""),
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
        command: createCommand("dotnet publish"),
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

  it("字符上限边界落在 emoji 代理对中间时，不产生孤立代理项", () => {
    // 单行日志 16001 个 UTF-16 码元；截尾起点恰好是 🚀 的低位代理项。
    const emoji = "\u{1F680}";
    const tailText = "x".repeat(15_996) + "END";
    const outputLog = emoji + tailText;

    const excerpt = createFailedRecord(outputLog).outputExcerpt ?? "";

    expect(outputLog.length).toBe(16_001);
    // 摘录必须是合法 UTF-16：不能以孤立低位代理项开头。
    expect(hasLoneSurrogate(excerpt)).toBe(false);
    expect(
      excerpt.charCodeAt(0) >= 0xdc00 && excerpt.charCodeAt(0) <= 0xdfff
    ).toBe(false);
    expect(excerpt.length).toBeLessThanOrEqual(16_000);
    expect(excerpt.endsWith("END")).toBe(true);
    // 序列化后不应出现 \udXXX 形式的孤立代理项转义。
    expect(JSON.stringify(excerpt)).not.toMatch(/\\ud[89a-f]/i);
  });

  it("截尾起点是完整码点（BMP）时，仍严格保留 16000 个码元", () => {
    const outputLog = "a".repeat(16_050);
    const excerpt = createFailedRecord(outputLog).outputExcerpt ?? "";

    expect(excerpt).toBe("a".repeat(16_000));
    expect(excerpt.length).toBe(16_000);
    expect(hasLoneSurrogate(excerpt)).toBe(false);
  });

  it("完整位于摘录内部的 emoji 不被误删", () => {
    const emoji = "\u{1F680}";
    const outputLog = "a".repeat(51) + "b".repeat(15_948) + emoji + "END";

    const excerpt = createFailedRecord(outputLog).outputExcerpt ?? "";

    expect(excerpt).toContain(emoji);
    expect(excerpt.endsWith("END")).toBe(true);
    expect(excerpt.length).toBe(16_000);
    expect(hasLoneSurrogate(excerpt)).toBe(false);
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
