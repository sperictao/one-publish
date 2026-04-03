import { describe, expect, it } from "vitest";

import {
  deriveFailureSignature,
  extractFailureContext,
  normalizeFailureSignature,
  resolveFailureSignature,
} from "@/lib/failureSignature";

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

  it("支持回放已持久化的 failureSignature", () => {
    const signature = resolveFailureSignature({
      failureSignature: "cargo::toolchain missing",
      error: "error: this should not be used",
      commandLine: "$ cargo build",
    });

    expect(signature).toBe("cargo::toolchain missing");
  });
});
