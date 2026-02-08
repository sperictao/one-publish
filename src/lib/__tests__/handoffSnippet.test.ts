import { describe, expect, it } from "vitest";

import {
  buildGitHubActionsSnippet,
  buildShellHandoffSnippet,
} from "@/lib/handoffSnippet";

describe("handoffSnippet", () => {
  const spec = {
    provider_id: "dotnet",
    project_path: "/tmp/demo/src/app.csproj",
    parameters: {
      configuration: "Release",
      runtime: "linux-x64",
    },
  };

  it("生成 shell 片段时保留项目路径上下文", () => {
    const snippet = buildShellHandoffSnippet({
      spec,
      commandLine: "$ dotnet publish /tmp/demo/src/app.csproj -c Release",
    });

    expect(snippet).toContain('# provider: dotnet');
    expect(snippet).toContain('cd "/tmp/demo/src"');
    expect(snippet).toContain("dotnet publish /tmp/demo/src/app.csproj -c Release");
  });

  it("生成 GitHub Actions 片段时包含 working-directory", () => {
    const snippet = buildGitHubActionsSnippet({
      spec,
      commandLine: "$ dotnet publish /tmp/demo/src/app.csproj -c Release",
    });

    expect(snippet).toContain("- name: Publish (dotnet)");
    expect(snippet).toContain("working-directory: /tmp/demo/src");
    expect(snippet).toContain("run: |");
  });

  it("命令缺失时回退到 provider 默认命令", () => {
    const snippet = buildShellHandoffSnippet({
      spec: {
        provider_id: "go",
        project_path: "/tmp/go-demo",
        parameters: {},
      },
      commandLine: null,
    });

    expect(snippet).toContain('cd "/tmp/go-demo"');
    expect(snippet).toContain("go build ./...");
  });
});
