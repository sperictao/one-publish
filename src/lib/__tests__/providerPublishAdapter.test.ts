import { describe, expect, it } from "vitest";

import {
  buildProviderPublishSpec,
  type DotnetPublishIntentConfig,
} from "@/features/config/providerPublishAdapter";

const dotnetConfig: DotnetPublishIntentConfig = {
  configuration: "Release",
  runtime: "osx-arm64",
  framework: "net8.0",
  self_contained: true,
  output_dir: "/out",
  no_build: false,
  no_restore: true,
  verbosity: "minimal",
  no_logo: true,
  delete_existing_files: true,
  properties: {
    DefineConstants: "CI",
    PublishProvider: "FileSystem",
    PublishSingleFile: "true",
  },
  use_profile: false,
  profile_name: "",
};

describe("providerPublishAdapter", () => {
  it("builds dotnet publish specs from the dotnet intent fragment", () => {
    const spec = buildProviderPublishSpec({
      providerId: "dotnet",
      providerUsesProjectFile: true,
      providerParameters: {},
      projectInfo: {
        root_path: "/repo",
        project_file: "/repo/App.csproj",
        publish_profiles: [],
        target_frameworks: ["net8.0"],
      },
      repository: { path: "/repo" },
      specVersion: 1,
      dotnetConfig,
    });

    expect(spec).toMatchObject({
      version: 1,
      provider_id: "dotnet",
      project_path: "/repo/App.csproj",
      parameters: {
        configuration: "Release",
        runtime: "osx-arm64",
        framework: "net8.0",
        self_contained: true,
        output: "/out",
        no_restore: true,
        no_logo: true,
        delete_existing_files: true,
        properties: {
          DefineConstants: "CI",
          PublishSingleFile: "true",
        },
      },
    });
  });

  it("builds project profile specs as PublishProfile properties", () => {
    const spec = buildProviderPublishSpec({
      providerId: "dotnet",
      providerUsesProjectFile: true,
      providerParameters: {},
      projectInfo: {
        root_path: "/repo",
        project_file: "/repo/App.csproj",
        publish_profiles: ["FolderProfile"],
        target_frameworks: ["net8.0"],
      },
      repository: { path: "/repo" },
      specVersion: 1,
      dotnetConfig: {
        configuration: "Release",
        runtime: "",
        framework: "",
        self_contained: false,
        output_dir: "",
        no_build: false,
        no_restore: false,
        verbosity: "",
        no_logo: false,
        delete_existing_files: false,
        properties: {},
        use_profile: true,
        profile_name: "FolderProfile",
      },
    });

    expect(spec).toEqual({
      version: 1,
      provider_id: "dotnet",
      project_path: "/repo/App.csproj",
      parameters: {
        properties: {
          PublishProfile: "FolderProfile",
        },
      },
    });
  });

  it("builds generic provider specs from provider parameters", () => {
    expect(
      buildProviderPublishSpec({
        providerId: "cargo",
        providerUsesProjectFile: false,
        providerParameters: { release: true },
        projectInfo: null,
        repository: { path: "/repo" },
        specVersion: 2,
      })
    ).toEqual({
      version: 2,
      provider_id: "cargo",
      project_path: "/repo",
      parameters: { release: true },
    });
  });

  it("returns null when the provider project path is missing", () => {
    expect(
      buildProviderPublishSpec({
        providerId: "cargo",
        providerUsesProjectFile: false,
        providerParameters: {},
        projectInfo: null,
        repository: null,
        specVersion: 1,
      })
    ).toBeNull();
  });

  it("returns null when dotnet config is missing", () => {
    expect(
      buildProviderPublishSpec({
        providerId: "dotnet",
        providerUsesProjectFile: true,
        providerParameters: {},
        projectInfo: {
          root_path: "/repo",
          project_file: "/repo/App.csproj",
          publish_profiles: [],
          target_frameworks: [],
        },
        repository: { path: "/repo" },
        specVersion: 1,
      })
    ).toBeNull();
  });
});
