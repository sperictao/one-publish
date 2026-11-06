import { describe, expect, it } from "vitest";

import {
  deriveFailureSignature,
  extractFailureContext,
  normalizeFailureSignature,
  resolveFailureSignature,
} from "@/features/history/failureSignature";

/** UTF-16 字符串中是否存在孤立代理项（无法编码成合法 Unicode 标量值）。 */
function hasIsolatedSurrogate(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return true;
      }
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

describe("failureSignature", () => {
  it("优先从输出中提取错误关键词行", () => {
    const line = extractFailureContext(
      [
        "[info] start build",
        "[stderr] warning: flaky cache",
        "error CS0246: The type or namespace name Foo could not be found",
      ].join("\n")
    );

    expect(line).toBe(
      "error CS0246: The type or namespace name Foo could not be found"
    );
  });

  it("归一化签名会消除路径和数字噪声", () => {
    const signature = normalizeFailureSignature(
      "Build failed at /Users/demo/work/app/src/main.cs line 128, code 500"
    );

    expect(signature).toContain("<path>");
    expect(signature).toContain("<num>");
    expect(signature).not.toContain("/Users/demo/work");
    expect(signature).not.toContain("128");
  });

  it("推导签名时优先使用 error 字段", () => {
    const signature = deriveFailureSignature({
      error: "panic: unexpected EOF in payload",
      output: "error: this line should be ignored",
    });

    expect(signature).toBe("panic: unexpected eof in payload");
  });

  it("旧记录从 outputExcerpt 推导签名，而非把命令行当错误日志", () => {
    const signature = resolveFailureSignature({
      error: null,
      failureSignature: null,
      commandLine: "$ dotnet publish demo.csproj",
      outputExcerpt: "[info] start build\nerror CS0246: missing namespace",
    });

    expect(signature).toContain("missing namespace");
    expect(signature).toContain("error");
    expect(signature).not.toContain("start build");
    expect(signature).not.toContain("dotnet publish");
  });

  it("无输出摘要且命令行不含错误关键词时保持原有 null 结果", () => {
    const signature = resolveFailureSignature({
      error: null,
      failureSignature: null,
      commandLine: "$ dotnet publish demo.csproj",
      outputExcerpt: null,
    });

    expect(signature).toBeNull();
  });

  it("已持久化的 failureSignature 优先于 outputExcerpt", () => {
    const signature = resolveFailureSignature({
      failureSignature: "cargo::toolchain missing",
      error: null,
      commandLine: "$ cargo build",
      outputExcerpt: "error CS0246: missing namespace",
    });

    expect(signature).toBe("cargo::toolchain missing");
  });

  it("error 字段仍优先于 outputExcerpt", () => {
    const signature = resolveFailureSignature({
      error: "panic: unexpected EOF",
      failureSignature: null,
      commandLine: "$ cargo build",
      outputExcerpt: "error CS0246: missing namespace",
    });

    expect(signature).toBe("panic: unexpected eof");
  });

  it("支持回放已持久化的 failureSignature", () => {
    const signature = resolveFailureSignature({
      failureSignature: "cargo::toolchain missing",
      error: "error: this should not be used",
      commandLine: "$ cargo build",
    });

    expect(signature).toBe("cargo::toolchain missing");
  });

  // 160 码元上限是 UTF-16 码元数而非字符数；截断点正好落在代理对中间时，
  // slice(0, 160) 会把高位代理项留下、低位代理项截掉。签名随后被持久化进
  // ExecutionRecord 并经 IPC 交给 Rust serde_json（孤立代理项不是合法标量值），
  // 还用于失败分组、诊断导出与 UI 展示。
  it("截断不会在签名末尾留下孤立的高位代理项", () => {
    // "error: "（7） + 152 个 a（159） ⇒ emoji 的高位代理项落在第 159 码元、
    // 低位代理项落在第 160 码元，正好被截断边界切开。
    const raw = `error: ${"a".repeat(152)}😀tail`;
    const signature = normalizeFailureSignature(raw);

    expect(signature.length).toBeLessThanOrEqual(160);
    expect(signature.length).toBeGreaterThan(0);
    expect(hasIsolatedSurrogate(signature)).toBe(false);
    expect(signature.endsWith("😀")).toBe(false);
    expect(signature.startsWith("error: aaa")).toBe(true);
  });

  it("推导出的持久化签名同样不含孤立代理项", () => {
    const signature = deriveFailureSignature({
      error: `error: ${"a".repeat(152)}😀tail`,
    });

    expect(signature).not.toBeNull();
    expect(hasIsolatedSurrogate(signature ?? "")).toBe(false);
  });

  it("完整落在截断边界内的代理对保持原样", () => {
    // "error: "（7） + 151 个 a（158） ⇒ 代理对占第 158/159 码元，都 ≤ 160。
    const signature = normalizeFailureSignature(
      `error: ${"a".repeat(151)}😀tail`
    );

    expect(signature).toContain("😀");
    expect(hasIsolatedSurrogate(signature)).toBe(false);
    expect(signature.length).toBe(160);
  });

  it("纯 BMP 长字符串仍按 160 码元截断且行为不变", () => {
    const signature = normalizeFailureSignature(`error: ${"a".repeat(200)}`);

    expect(signature).toBe(`error: ${"a".repeat(153)}`);
    expect(signature.length).toBe(160);
    expect(hasIsolatedSurrogate(signature)).toBe(false);
  });
});
