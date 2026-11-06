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

  it("Tauri 缺少已选定驱动的命令时明确提示，不猜测驱动", () => {
    const snippet = buildShellHandoffSnippet({
      spec: {
        provider_id: "tauri",
        project_path: "/repo/src-tauri/tauri.conf.json",
        parameters: {},
      },
    });
    expect(snippet).toContain("tauri: 未提供实际构建命令");
    expect(snippet).not.toContain("cargo tauri");
    expect(snippet).not.toContain("pnpm tauri");
  });

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

  it("裸文件名项目路径回退到当前目录", () => {
    const snippet = buildShellHandoffSnippet({
      spec: { ...spec, project_path: "App.csproj" },
      commandLine: "$ dotnet publish App.csproj -c Release",
    });

    expect(snippet).toContain('cd "."');
  });

  it("根目录单文件项目路径使用文件系统根作为工作目录", () => {
    const rootSpec = { ...spec, project_path: "/App.csproj" };

    expect(buildShellHandoffSnippet({ spec: rootSpec })).toContain('cd "/"');
    expect(buildGitHubActionsSnippet({ spec: rootSpec }).split("\n")).toContain(
      "  working-directory: /"
    );
    expect(buildGitLabCISnippet({ spec: rootSpec })).toContain('- cd "/"');
  });

  it("Windows 反斜杠根目录单文件同样解析为文件系统根", () => {
    const snippet = buildShellHandoffSnippet({
      spec: { ...spec, project_path: "\\App.csproj" },
    });

    expect(snippet).toContain('cd "/"');
    expect(snippet).not.toContain('cd "."');
  });

  it("Windows 盘符根单文件项目路径使用盘符根作为工作目录", () => {
    const driveSpec = { ...spec, project_path: "C:/App.csproj" };

    expect(buildShellHandoffSnippet({ spec: driveSpec })).toContain('cd "C:/"');
    expect(
      buildGitHubActionsSnippet({ spec: driveSpec }).split("\n")
    ).toContain("  working-directory: C:/");
    expect(buildGitLabCISnippet({ spec: driveSpec })).toContain('- cd "C:/"');
  });

  it("Windows 盘符根单文件不会退回盘符相对路径 C:", () => {
    const snippet = buildShellHandoffSnippet({
      spec: { ...spec, project_path: "C:\\App.csproj" },
    });

    expect(snippet).toContain('cd "C:/"');
    expect(snippet).not.toContain('cd "C:"');
  });

  it("小写盘符根单文件保留原盘符大小写", () => {
    const snippet = buildShellHandoffSnippet({
      spec: { ...spec, project_path: "d:/App.csproj" },
    });

    expect(snippet).toContain('cd "d:/"');
  });

  it("盘符下的子目录单文件仍解析到完整父目录", () => {
    const snippet = buildShellHandoffSnippet({
      spec: { ...spec, project_path: "C:/repo/src/App.csproj" },
    });

    expect(snippet).toContain('cd "C:/repo/src"');
  });

  it("空项目路径同样回退到当前目录", () => {
    const snippet = buildShellHandoffSnippet({
      spec: { ...spec, project_path: "" },
      commandLine: "$ dotnet publish App.csproj -c Release",
    });

    expect(snippet).toContain('cd "."');
  });

  it("纯空白项目路径的 shell 片段回退到当前目录", () => {
    const snippet = buildShellHandoffSnippet({
      spec: { ...spec, project_path: "   " },
      commandLine: "$ dotnet publish -c Release",
    });

    expect(snippet).toContain('cd "."');
    expect(snippet).not.toContain('cd "   "');
  });

  it("纯空白项目路径的 GitHub Actions 片段回退到当前目录", () => {
    const snippet = buildGitHubActionsSnippet({
      spec: { ...spec, project_path: "\t\n " },
      commandLine: "$ dotnet publish -c Release",
    });

    expect(snippet.split("\n")).toContain("  working-directory: .");
    expect(snippet).not.toContain("working-directory: \t");
  });

  it("纯空白项目路径的 GitLab CI 片段回退到当前目录", () => {
    const snippet = buildGitLabCISnippet({
      spec: { ...spec, project_path: "  \t  " },
      commandLine: "$ dotnet publish -c Release",
    });

    expect(snippet).toContain('    - cd "."');
    expect(snippet).not.toContain('    - cd "  ');
  });

  it("含空格但非纯空白的项目路径工作目录保持不变", () => {
    const snippet = buildShellHandoffSnippet({
      spec: { ...spec, project_path: "/tmp/my project/src/" },
      commandLine: "$ dotnet publish -c Release",
    });

    expect(snippet).toContain('cd "/tmp/my project/src/"');
  });

  it("尾斜杠目录路径原样作为工作目录", () => {
    const snippet = buildShellHandoffSnippet({
      spec: { ...spec, project_path: "/tmp/demo/src/" },
      commandLine: "$ dotnet publish -c Release",
    });

    expect(snippet).toContain('cd "/tmp/demo/src/"');
  });

  it("空白命令行回退到 provider 默认命令", () => {
    const snippet = buildShellHandoffSnippet({
      spec,
      commandLine: "   ",
    });

    expect(snippet.split("\n").pop()).toContain("dotnet publish");
  });
});
