import { describe, expect, it } from "vitest";

import {
  isGenericPublishFailureMessage,
  normalizePublishResult,
  resolvePublishFailureMessage,
} from "@/lib/publishFailure";

describe("publishFailure", () => {
  const command = {
    program: "dotnet",
    args: ["publish", "/repo/App.csproj"],
    working_dir: "/repo",
    display_command: "dotnet publish /repo/App.csproj",
  };

  it("generic 退出码错误会回退到输出中的真实失败行", () => {
    expect(isGenericPublishFailureMessage("发布失败，退出代码: Some(1)")).toBe(true);
    expect(
      resolvePublishFailureMessage({
        error: "发布失败，退出代码: Some(1)",
        outputLog: [
          "$ dotnet publish /repo/App.csproj",
          "error CS0246: The type or namespace name Foo could not be found",
          "Build FAILED.",
        ].join("\n"),
      })
    ).toBe(
      "error CS0246: The type or namespace name Foo could not be found"
    );
  });

  it("失败结果归一化时只替换 generic 错误摘要", () => {
    expect(
      normalizePublishResult({
        result: {
          provider_id: "dotnet",
          success: false,
          cancelled: false,
          error: "发布失败，退出代码: Some(1)",
          command,
          output_log: "$ dotnet publish /repo/App.csproj\nerror CS0246: Foo missing",
          output_dir: "",
          file_count: 0,
        },
        outputLog:
          "$ dotnet publish /repo/App.csproj\nerror CS0246: Foo missing",
      }).error
    ).toBe("error CS0246: Foo missing");

    expect(
      normalizePublishResult({
        result: {
          provider_id: "dotnet",
          success: false,
          cancelled: false,
          error: "MSBuild failed: missing SDK",
          command,
          output_log: "$ dotnet publish /repo/App.csproj\nerror CS0246: Foo missing",
          output_dir: "",
          file_count: 0,
        },
        outputLog:
          "$ dotnet publish /repo/App.csproj\nerror CS0246: Foo missing",
      }).error
    ).toBe("MSBuild failed: missing SDK");
  });
});
