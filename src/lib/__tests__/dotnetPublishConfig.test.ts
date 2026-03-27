import { describe, expect, it } from "vitest";

import {
  buildDotnetAdvancedParameters,
  buildDotnetProfileParameters,
  createDotnetPublishConfigPatchFromParameter,
  createDefaultDotnetPublishConfig,
  createDotnetPublishConfigFromParameters,
} from "@/lib/dotnetPublishConfig";

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
      properties: {
        Version: "1.0.0",
      },
      define: ["A"],
    });
  });

  it("根据参数项生成 dotnet 配置补丁", () => {
    expect(
      createDotnetPublishConfigPatchFromParameter("properties", {
        Version: 1,
        PublishTrimmed: true,
      })
    ).toEqual({
      properties: {
        Version: "1",
        PublishTrimmed: "true",
      },
    });

    expect(
      createDotnetPublishConfigPatchFromParameter("define", ["A", " B "])
    ).toEqual({
      define: ["A", "B"],
    });

    expect(
      createDotnetPublishConfigPatchFromParameter("no_restore", true)
    ).toEqual({
      noRestore: true,
    });
  });
});
