import { describe, expect, it } from "vitest";

import { classifyLogLine } from "@/features/publish/classifyLogLine";

describe("classifyLogLine", () => {
  it("识别 .NET 编译器错误诊断码", () => {
    expect(classifyLogLine("Program.cs(10,5): error CS1002: ; expected")).toBe(
      "error"
    );
  });

  it("识别 MSBuild 警告诊断码", () => {
    expect(
      classifyLogLine("proj.csproj : warning MSB3277: Found conflicts")
    ).toBe("warning");
  });

  it("识别字母前缀超过 5 位的 .NET 诊断码", () => {
    // NETSDK / SYSLIB 均为 6 字母前缀，旧正则的 {1,5} 会把它们漏判为 plain
    expect(
      classifyLogLine(
        "/repo/App.csproj : warning NETSDK1138: The target framework 'net6.0' is out of support"
      )
    ).toBe("warning");
    expect(
      classifyLogLine(
        "Program.cs(1,1): error SYSLIB1001: 'WebRequest' is obsolete"
      )
    ).toBe("error");
  });

  it("诊断码前缀不设长度上限，但无数字码的行仍为 plain", () => {
    expect(
      classifyLogLine("proj.csproj : error VERYLONGPREFIX1234: custom analyzer")
    ).toBe("error");
    expect(classifyLogLine(": warning NETSDK: missing numeric code")).toBe(
      "plain"
    );
  });

  it("识别行首 error: 前缀", () => {
    expect(classifyLogLine("error: build failed")).toBe("error");
    expect(classifyLogLine("  ERROR: something")).toBe("error");
  });

  it("识别行首 warning: 前缀", () => {
    expect(classifyLogLine("warning: deprecated API")).toBe("warning");
  });

  it("普通输出行归类为 plain", () => {
    expect(classifyLogLine("Restoring packages...")).toBe("plain");
    expect(classifyLogLine("Build succeeded.")).toBe("plain");
    // 不因单词 error 出现在中间就误判
    expect(classifyLogLine("0 Error(s)")).toBe("plain");
  });
});
