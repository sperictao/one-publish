import { describe, expect, it } from "vitest";

import {
  buildGitHubActionsSnippet,
  buildGitLabCISnippet,
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

    expect(snippet).toContain("# provider: dotnet");
    expect(snippet).toContain('cd "/tmp/demo/src"');
    expect(snippet).toContain(
      "dotnet publish /tmp/demo/src/app.csproj -c Release"
    );
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

  it("生成 GitLab CI 片段时使用 stage:deploy 与 cd script", () => {
    const snippet = buildGitLabCISnippet({
      spec,
      commandLine: "$ dotnet publish /tmp/demo/src/app.csproj -c Release",
    });

    expect(snippet).toContain("publish:");
    expect(snippet).toContain("  stage: deploy");
    expect(snippet).toContain("  script:");
    expect(snippet).toContain('    - cd "/tmp/demo/src"');
    expect(snippet).toContain(
      "    - dotnet publish /tmp/demo/src/app.csproj -c Release"
    );
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

  it("GitLab CI 片段对 cargo provider 回退为 cargo build --release", () => {
    const snippet = buildGitLabCISnippet({
      spec: {
        provider_id: "cargo",
        project_path: "/tmp/cargo-demo",
        parameters: {},
      },
      commandLine: null,
    });

    expect(snippet).toContain('    - cd "/tmp/cargo-demo"');
    expect(snippet).toContain("    - cargo build --release");
  });

  it("GitLab CI 片段对 java provider 回退为 ./gradlew build", () => {
    const snippet = buildGitLabCISnippet({
      spec: {
        provider_id: "java",
        project_path: "/tmp/java-demo",
        parameters: {},
      },
      commandLine: null,
    });

    expect(snippet).toContain('    - cd "/tmp/java-demo"');
    expect(snippet).toContain("    - ./gradlew build");
  });

  it("GitLab CI 片段对 dotnet provider 在无命令时回退到 dotnet publish", () => {
    const snippet = buildGitLabCISnippet({
      spec: {
        provider_id: "dotnet",
        project_path: "/tmp/dotnet-demo/app.csproj",
        parameters: {},
      },
      commandLine: null,
    });

    expect(snippet).toContain('    - cd "/tmp/dotnet-demo"');
    expect(snippet).toContain(
      '    - dotnet publish "/tmp/dotnet-demo/app.csproj"'
    );
  });
});
