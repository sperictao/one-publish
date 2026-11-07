import { describe, expect, it } from "vitest";

import { interpolateTemplate } from "@/lib/interpolateTemplate";

describe("interpolateTemplate", () => {
  it("renders parameter values containing $ replacement patterns literally", () => {
    const raw = "/out/$&-$$-$'-$`";

    expect(interpolateTemplate("输出目录: {{dir}}", { dir: raw })).toBe(
      `输出目录: ${raw}`
    );
  });

  it("replaces every occurrence and keeps unknown placeholders intact", () => {
    expect(interpolateTemplate("{{key}} 与 {{key}}", { key: "K" })).toBe(
      "K 与 K"
    );
    expect(
      interpolateTemplate("共 {{count}} 项，保留 {{missing}}", { count: 3 })
    ).toBe("共 3 项，保留 {{missing}}");
  });

  it("does not re-expand placeholder-like text inserted by an earlier parameter", () => {
    expect(
      interpolateTemplate("先 {{first}} 后 {{second}}", {
        first: "{{second}}",
        second: "done",
      })
    ).toBe("先 {{second}} 后 done");
  });

  it("matches parameter keys literally instead of compiling them as regex", () => {
    expect(interpolateTemplate("{{a.b}} {{axb}}", { "a.b": "OK" })).toBe(
      "OK {{axb}}"
    );
    expect(interpolateTemplate("{{(}}", { "(": "X" })).toBe("X");
  });

  it("stringifies numeric values", () => {
    expect(interpolateTemplate("{{count}} items", { count: 0 })).toBe(
      "0 items"
    );
  });
});
