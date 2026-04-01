import { describe, expect, it } from "vitest";

import { buildDotnetAdvancedFieldsModel } from "@/lib/dotnetPublishAdvancedFields";
import type { PublishConfigStore } from "@/lib/store";
import type { ParameterSchema } from "@/types/parameters";

const dotnetSchema: ParameterSchema = {
  parameters: {
    configuration: {
      type: "string",
      flag: "--configuration",
    },
    runtime: {
      type: "string",
      flag: "--runtime",
    },
    output: {
      type: "string",
      flag: "--output",
    },
    self_contained: {
      type: "boolean",
      flag: "--self-contained",
    },
    framework: {
      type: "string",
      flag: "--framework",
      description: "Target framework",
    },
    no_build: {
      type: "boolean",
      flag: "--no-build",
      description: "Skip build",
    },
    no_restore: {
      type: "boolean",
      flag: "--no-restore",
      description: "Skip restore",
    },
    verbosity: {
      type: "string",
      flag: "--verbosity",
      description: "Verbosity level",
    },
    no_logo: {
      type: "boolean",
      flag: "--no-logo",
      description: "Hide logo",
    },
    properties: {
      type: "map",
      flag: "",
      prefix: "-p:",
      description: "MSBuild properties",
    },
    define: {
      type: "array",
      flag: "--define",
      description: "Conditional compilation symbols",
    },
  },
};

const config: PublishConfigStore = {
  configuration: "Release",
  runtime: "",
  framework: "net9.0",
  selfContained: false,
  outputDir: "",
  noBuild: false,
  noRestore: false,
  verbosity: "minimal",
  noLogo: false,
  properties: {
    DeleteExistingFiles: "true",
    PublishProvider: "FileSystem",
    LastUsedBuildConfiguration: "Release",
    PublishSingleFile: "true",
    CustomProperty: "CustomValue",
  },
  define: ["TRACE", "CI"],
  useProfile: false,
  profileName: "",
};

describe("buildDotnetAdvancedFieldsModel", () => {
  it("按 dotnet 专用字段模型输出高级参数控件类型与分组", () => {
    const model = buildDotnetAdvancedFieldsModel({
      config,
      dotnetSchema,
      projectFrameworkOptions: ["net8.0", "net9.0"],
    });

    const framework = model.fieldMap.get("framework");
    const verbosity = model.fieldMap.get("verbosity");
    const noBuild = model.fieldMap.get("no_build");
    const publishProvider = model.fieldMap.get("PublishProvider");
    const deleteExistingFiles = model.fieldMap.get("DeleteExistingFiles");
    const publishSingleFile = model.fieldMap.get("PublishSingleFile");
    const define = model.fieldMap.get("define");
    const properties = model.fieldMap.get("properties");

    expect(model.baseFields.map((field) => field.key)).toEqual(
      expect.arrayContaining([
        "framework",
        "DeleteExistingFiles",
        "LastUsedBuildConfiguration",
        "PublishProvider",
      ])
    );
    expect(model.collapsedFields.map((field) => field.key)).toEqual(
      expect.arrayContaining([
        "no_build",
        "verbosity",
        "PublishSingleFile",
        "define",
        "properties",
      ])
    );

    expect(framework?.control).toBe("framework-suggestions");
    expect(framework?.options).toEqual(
      expect.arrayContaining([
        { value: "net8.0", label: "net8.0" },
        { value: "net9.0", label: "net9.0" },
      ])
    );
    expect(verbosity?.control).toBe("select");
    expect(noBuild?.control).toBe("boolean");
    expect(deleteExistingFiles?.control).toBe("boolean");
    expect(publishSingleFile?.control).toBe("boolean");
    expect(publishProvider?.control).toBe("string");
    expect(define?.control).toBe("tags");
    expect(properties?.control).toBe("property-map");
    expect(properties?.value).toEqual({
      CustomProperty: "CustomValue",
    });
  });
});
