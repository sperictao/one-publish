import { describe, expect, it } from "vitest";

import {
  buildDotnetAdvancedParameters,
  buildDotnetPublishCommand,
  buildDotnetProfileParameters,
  createDefaultDotnetPublishConfig,
  createDotnetPublishConfigFromParameters,
} from "@/features/config/dotnetPublishConfig";

describe("dotnetPublishConfig", () => {
  it("构建 dotnet 参数时包含高级字段", () => {
    const config = {
      ...createDefaultDotnetPublishConfig(),
      configuration: "Release",
      runtime: "linux-x64",
      framework: "net8.0",
      selfContained: true,
      outputDir: "./publish",
      noBuild: true,
      noRestore: true,
      verbosity: "diagnostic",
      noLogo: true,
      properties: {
        Version: "1.2.3",
      },
      define: ["A", "B"],
    };

    expect(buildDotnetProfileParameters(config)).toEqual({
      configuration: "Release",
      runtime: "linux-x64",
      framework: "net8.0",
      self_contained: true,
      output: "./publish",
      no_build: true,
      no_restore: true,
      verbosity: "diagnostic",
      no_logo: true,
      properties: {
        Version: "1.2.3",
      },
      define: ["A", "B"],
    });
  });

  it("从参数快照恢复 dotnet 配置", () => {
    const restored = createDotnetPublishConfigFromParameters({
      configuration: "Debug",
      runtime: "win-x64",
      framework: "net9.0",
      output: "./out",
      self_contained: true,
      no_build: true,
      verbosity: "minimal",
      no_logo: true,
      properties: {
        Version: "2.0.0",
        PublishTrimmed: false,
      },
      define: ["TRACE"],
    });

    expect(restored).toMatchObject({
      configuration: "Debug",
      runtime: "win-x64",
      framework: "net9.0",
      outputDir: "./out",
      selfContained: true,
      noBuild: true,
      noRestore: false,
      verbosity: "minimal",
      noLogo: true,
      properties: {
        Version: "2.0.0",
        PublishTrimmed: "false",
      },
      define: ["TRACE"],
      useProfile: false,
      profileName: "",
    });
  });

  it("从属性映射中提取 DeleteExistingFiles 并标准化为布尔值", () => {
    const restored = createDotnetPublishConfigFromParameters({
      properties: {
        DeleteExistingFiles: "true",
        PublishTrimmed: "false",
      },
    });

    expect(restored.deleteExistingFiles).toBe(true);
    expect(restored.properties).toEqual({
      PublishTrimmed: "false",
    });
    expect(buildDotnetProfileParameters(restored)).toEqual({
      configuration: "Release",
      delete_existing_files: true,
      properties: {
        PublishTrimmed: "false",
      },
    });
  });

  it("一等 delete_existing_files 优先于属性映射里的 DeleteExistingFiles", () => {
    const restored = createDotnetPublishConfigFromParameters({
      delete_existing_files: false,
      properties: {
        DeleteExistingFiles: "true",
        PublishTrimmed: "false",
      },
    });

    expect(restored.deleteExistingFiles).toBe(false);
    expect(restored.properties).toEqual({
      PublishTrimmed: "false",
    });
  });

  it("生成高级参数草稿", () => {
    const config = {
      ...createDefaultDotnetPublishConfig(),
      framework: "net8.0",
      noBuild: true,
      properties: {
        Version: "1.0.0",
      },
      define: ["A"],
    };

    expect(buildDotnetAdvancedParameters(config)).toEqual({
      framework: "net8.0",
      no_build: true,
      no_restore: false,
      verbosity: "",
      no_logo: false,
      delete_existing_files: false,
      properties: {
        Version: "1.0.0",
      },
      define: ["A"],
    });
  });

  it("可从 PublishProfile 属性恢复配置文件选择", () => {
    const restored = createDotnetPublishConfigFromParameters(
      {
        properties: {
          PublishProfile: "FolderProfile",
        },
      },
      {
        inferProfileSelection: true,
      }
    );

    expect(restored.useProfile).toBe(true);
    expect(restored.profileName).toBe("FolderProfile");
    expect(buildDotnetProfileParameters(restored)).toEqual({
      properties: {
        PublishProfile: "FolderProfile",
      },
    });
  });

  it("根据参数快照生成 dotnet publish 命令预览", () => {
    expect(
      buildDotnetPublishCommand("/tmp/app.csproj", {
        configuration: "Release",
        runtime: "linux-x64",
        framework: "net8.0",
        self_contained: true,
        output: "./publish",
        no_build: true,
        no_restore: true,
        verbosity: "minimal",
        no_logo: true,
        define: ["TRACE"],
        properties: {
          PublishTrimmed: "true",
        },
      })
    ).toBe(
      'dotnet publish "/tmp/app.csproj" -c Release --runtime linux-x64 --framework net8.0 --self-contained -o "./publish" --no-build --no-restore --verbosity minimal --no-logo --define TRACE -p:PublishTrimmed=true'
    );
  });
});
