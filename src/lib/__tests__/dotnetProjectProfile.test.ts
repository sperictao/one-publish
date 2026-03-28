import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readProjectPublishProfile: vi.fn(),
}));

vi.mock("@/lib/store", async () => {
  const actual = await vi.importActual<typeof import("@/lib/store")>("@/lib/store");
  return {
    ...actual,
    readProjectPublishProfile: mocks.readProjectPublishProfile,
  };
});

import { resolveDotnetProjectProfile } from "@/lib/dotnetProjectProfile";

describe("resolveDotnetProjectProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("解析项目发布配置并返回共享结果", async () => {
    mocks.readProjectPublishProfile.mockResolvedValue({
      profileName: "FolderProfile",
      filePath: "/repo/Properties/PublishProfiles/FolderProfile.pubxml",
      content: `
        <Project>
          <PropertyGroup>
            <Configuration>Release</Configuration>
            <RuntimeIdentifier>linux-x64</RuntimeIdentifier>
            <PublishDir>./publish</PublishDir>
            <NoBuild>true</NoBuild>
          </PropertyGroup>
        </Project>
      `,
    });

    const resolved = await resolveDotnetProjectProfile({
      projectInfo: {
        root_path: "/repo",
        project_file: "/repo/MyApp.csproj",
      },
      profileName: "FolderProfile",
    });

    expect(mocks.readProjectPublishProfile).toHaveBeenCalledWith(
      "/repo/MyApp.csproj",
      "FolderProfile"
    );
    expect(resolved.profileName).toBe("FolderProfile");
    expect(resolved.filePath).toBe(
      "/repo/Properties/PublishProfiles/FolderProfile.pubxml"
    );
    expect(resolved.parsedProfile.sections).toHaveLength(1);
    expect(resolved.parameters).toEqual({
      configuration: "Release",
      runtime: "linux-x64",
      output: "./publish",
      no_build: true,
    });
  });

  it("在 pubxml 缺少输出目录时补齐默认输出目录", async () => {
    mocks.readProjectPublishProfile.mockResolvedValue({
      profileName: "FolderProfile",
      filePath: "/repo/Properties/PublishProfiles/FolderProfile.pubxml",
      content: `
        <Project>
          <PropertyGroup>
            <Configuration>Debug</Configuration>
          </PropertyGroup>
        </Project>
      `,
    });

    const resolved = await resolveDotnetProjectProfile({
      projectInfo: {
        root_path: "/repo",
        project_file: "/repo/MyApp.csproj",
      },
      profileName: "FolderProfile",
      defaultOutputDir: "/exports",
    });

    expect(resolved.parameters.output).toBe("/exports/MyApp/Debug");
  });

  it("根据共享参数结果生成可编辑的自定义配置", async () => {
    mocks.readProjectPublishProfile.mockResolvedValue({
      profileName: "FolderProfile",
      filePath: "/repo/Properties/PublishProfiles/FolderProfile.pubxml",
      content: `
        <Project>
          <PropertyGroup>
            <Configuration>Release</Configuration>
            <RuntimeIdentifier>osx-arm64</RuntimeIdentifier>
            <PublishSingleFile>true</PublishSingleFile>
          </PropertyGroup>
        </Project>
      `,
    });

    const resolved = await resolveDotnetProjectProfile({
      projectInfo: {
        root_path: "/repo",
        project_file: "/repo/MyApp.csproj",
      },
      profileName: "FolderProfile",
      defaultOutputDir: "/exports",
    });

    expect(resolved.editableConfig).toMatchObject({
      configuration: "Release",
      runtime: "osx-arm64",
      outputDir: "/exports/MyApp/Release",
      properties: {
        PublishSingleFile: "true",
      },
      useProfile: false,
      profileName: "",
    });
  });
});
