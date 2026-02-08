import { describe, expect, it } from "vitest";

import { buildFailureIssueDraft } from "@/lib/issueDraft";

describe("issueDraft", () => {
  it("生成包含签名与频次的 issue 草稿", () => {
    const draft = buildFailureIssueDraft({
      providerId: "dotnet",
      signature: "sdk missing",
      frequency: 4,
      representativeCommand: "$ dotnet publish src/app.csproj",
      records: [
        {
          id: "rec-1",
          finishedAt: "2026-02-08T12:00:00Z",
          projectPath: "/tmp/app.csproj",
          error: "SDK not found",
          snapshotPath: "/tmp/out/execution-snapshot-1.md",
        },
      ],
    });

    expect(draft).toContain("## Bug Summary");
    expect(draft).toContain("- provider: dotnet");
    expect(draft).toContain("- signature: sdk missing");
    expect(draft).toContain("- frequency: 4");
  });

  it("无快照时回退输出目录提示", () => {
    const draft = buildFailureIssueDraft({
      providerId: "cargo",
      signature: "toolchain missing",
      frequency: 2,
      records: [
        {
          id: "rec-2",
          finishedAt: "2026-02-08T12:00:00Z",
          projectPath: "/tmp/cargo",
          outputDir: "/tmp/cargo/target",
          error: "missing toolchain",
        },
      ],
    });

    expect(draft).toContain("snapshot: (not exported, output dir: /tmp/cargo/target)");
  });

  it("支持模板切换与可选章节", () => {
    const draft = buildFailureIssueDraft({
      providerId: "dotnet",
      signature: "sdk missing",
      frequency: 1,
      template: "incident",
      includeImpact: true,
      includeWorkaround: true,
      includeOwner: true,
      records: [],
    });

    expect(draft).toContain("## Incident Summary");
    expect(draft).toContain("## Impact");
    expect(draft).toContain("## Workaround");
    expect(draft).toContain("## Owner");
  });
});
