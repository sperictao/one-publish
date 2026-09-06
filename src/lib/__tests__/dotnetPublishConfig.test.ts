import { describe, expect, it } from "vitest";

import {
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
        DefineConstants: "A;B",
      },
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
        DefineConstants: "A;B",
        Version: "1.2.3",
      },
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
        PublishProvider: "FileSystem",
      },
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
      useProfile: false,
      profileName: "",
    });
  });

  it("剥离 dotnet publish 不支持的固定字段", () => {
    const config = {
      ...createDefaultDotnetPublishConfig(),
      properties: {
        DefineConstants: "TRACE;CI",
        LaunchSiteAfterPublish: "true",
        PublishProvider: "FileSystem",
        PublishSingleFile: "true",
        WebPublishMethod: "MSDeploy",
      },
    };

    expect(buildDotnetProfileParameters(config)).toEqual({
      configuration: "Release",
      properties: {
        DefineConstants: "TRACE;CI",
        PublishSingleFile: "true",
      },
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

  it("自定义配置引用 PublishProfile 时仍保持结构化参数", () => {
    const config = {
      ...createDefaultDotnetPublishConfig(),
      outputDir: "",
      useProfile: true,
      profileName: "FolderProfile",
    };

    expect(buildDotnetProfileParameters(config)).toEqual({
      properties: {
        PublishProfile: "FolderProfile",
      },
    });
  });

  // 已知缺陷（统一发布输入方案 Phase 1 记录）：富表单往返不是无损的。
  // 显式 false、null 值与黑名单属性在 参数 → 富表单 → 参数 的链路上被静默
  // 丢弃。统一草稿落地后将删除富表单往返（Phase 5），本测试仅固定缺陷现状，
  // 防止在迁移完成前丢失进一步恶化。
  it("[现有缺陷] 富表单往返丢失显式 false、null 与黑名单属性", () => {
    const original = {
      configuration: "Debug",
      self_contained: false,
      no_build: false,
      verbosity: null,
      properties: {
        Version: "1.2.3",
        TargetFramework: "net8.0",
      },
    };

    const rebuilt = buildDotnetProfileParameters(
      createDotnetPublishConfigFromParameters(original)
    );

    // 显式 false 丢失：无法区分"显式关闭"与"未设置"。
    expect(rebuilt.self_contained).toBeUndefined();
    expect(rebuilt.no_build).toBeUndefined();
    // null 值丢失：回落到富表单默认值而非保留。
    expect(rebuilt.verbosity).toBeUndefined();
    // 黑名单属性被静默删除：TargetFramework 不再出现。
    expect(rebuilt.properties).toEqual({ Version: "1.2.3" });
  });
});
