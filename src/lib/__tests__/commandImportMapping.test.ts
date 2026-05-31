import { describe, expect, it } from "vitest";

import { mapImportedSpecByProvider } from "@/features/provider/commandImportMapping";

describe("mapImportedSpecByProvider", () => {
  it("映射 dotnet 可落地字段并保留高级参数", () => {
    const result = mapImportedSpecByProvider(
      {
        provider_id: "dotnet",
        parameters: {
          configuration: "Release",
          runtime: "linux-x64",
          output: "./publish",
          self_contained: true,
          framework: "net8.0",
          no_build: true,
          no_restore: true,
          verbosity: "diagnostic",
          no_logo: true,
          properties: {
            Version: "1.2.3",
            PublishTrimmed: true,
          },
          define: ["A", "B"],
        },
      },
      "dotnet"
    );

    expect(result.providerId).toBe("dotnet");
    expect(result.dotnetUpdates).toEqual({
      configuration: "Release",
      runtime: "linux-x64",
      outputDir: "./publish",
      selfContained: true,
      framework: "net8.0",
      noBuild: true,
      noRestore: true,
      verbosity: "diagnostic",
      noLogo: true,
      properties: {
        Version: "1.2.3",
        PublishTrimmed: "true",
      },
      define: ["A", "B"],
    });
    expect(result.mappedKeys).toEqual([
      "configuration",
      "runtime",
      "output",
      "self_contained",
      "framework",
      "no_build",
      "no_restore",
      "verbosity",
      "no_logo",
      "properties",
      "define",
    ]);
    expect(result.unmappedKeys).toEqual([]);
  });

  it("按 schema key 映射 cargo 参数", () => {
    const result = mapImportedSpecByProvider(
      {
        provider_id: "cargo",
        parameters: {
          release: true,
          target: "x86_64-unknown-linux-gnu",
          features: ["a", "b"],
          unknown: "skip",
        },
      },
      "cargo",
      {
        supportedKeys: ["release", "target", "features"],
      }
    );

    expect(result.dotnetUpdates).toEqual({});
    expect(result.providerParameters).toEqual({
      release: true,
      target: "x86_64-unknown-linux-gnu",
      features: ["a", "b"],
    });
    expect(result.mappedKeys).toEqual(["release", "target", "features"]);
    expect(result.unmappedKeys).toEqual(["unknown"]);
  });

  it("兼容 DeleteExistingFiles 旗标并剥离属性映射", () => {
    const result = mapImportedSpecByProvider(
      {
        provider_id: "dotnet",
        parameters: {
          delete_existing_files: true,
          properties: {
            DeleteExistingFiles: "true",
            Version: "1.0.0",
          },
        },
      },
      "dotnet"
    );

    expect(result.dotnetUpdates).toEqual({
      deleteExistingFiles: true,
      properties: {
        Version: "1.0.0",
      },
    });
    expect(result.mappedKeys).toEqual([
      "delete_existing_files",
      "properties",
    ]);
    expect(result.unmappedKeys).toEqual([]);
  });

  it("从属性映射中接住 DeleteExistingFiles=false 并剥离原属性", () => {
    const result = mapImportedSpecByProvider(
      {
        provider_id: "dotnet",
        parameters: {
          properties: {
            DeleteExistingFiles: "false",
            Version: "1.0.0",
          },
        },
      },
      "dotnet"
    );

    expect(result.dotnetUpdates).toEqual({
      deleteExistingFiles: false,
      properties: {
        Version: "1.0.0",
      },
    });
    expect(result.mappedKeys).toEqual(["properties"]);
    expect(result.unmappedKeys).toEqual([]);
  });

  it("一等 delete_existing_files 优先于属性映射里的旧值", () => {
    const result = mapImportedSpecByProvider(
      {
        provider_id: "dotnet",
        parameters: {
          delete_existing_files: false,
          properties: {
            DeleteExistingFiles: "true",
          },
        },
      },
      "dotnet"
    );

    expect(result.dotnetUpdates).toEqual({
      deleteExistingFiles: false,
      properties: {},
    });
    expect(result.mappedKeys).toEqual([
      "delete_existing_files",
      "properties",
    ]);
    expect(result.unmappedKeys).toEqual([]);
  });

  it("保留 java map/array 参数结构", () => {
    const result = mapImportedSpecByProvider(
      {
        providerId: "java",
        parameters: {
          properties: {
            version: "1.2.3",
            profile: "prod",
          },
          exclude_task: ["test", "integrationTest"],
        },
      },
      "dotnet",
      {
        supportedKeys: ["properties", "exclude_task"],
      }
    );

    expect(result.providerId).toBe("java");
    expect(result.providerParameters).toEqual({
      properties: {
        version: "1.2.3",
        profile: "prod",
      },
      exclude_task: ["test", "integrationTest"],
    });
    expect(result.unmappedKeys).toEqual([]);
  });
});
