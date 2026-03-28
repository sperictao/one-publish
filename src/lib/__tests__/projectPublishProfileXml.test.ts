import { describe, expect, it } from "vitest";

import {
  extractDotnetPublishParametersFromProjectProfile,
  parseProjectPublishProfileXml,
} from "@/lib/projectPublishProfileXml";

describe("parseProjectPublishProfileXml", () => {
  it("解析 .pubxml 中的所有直接分组与嵌套参数", () => {
    const parsed = parseProjectPublishProfileXml(`
      <Project ToolsVersion="Current">
        <PropertyGroup>
          <Configuration>Release</Configuration>
          <RuntimeIdentifier>win-x64</RuntimeIdentifier>
          <PublishDir>bin/Release/net8.0/publish/</PublishDir>
        </PropertyGroup>
        <PropertyGroup Condition="'$(Configuration)'=='Debug'">
          <SelfContained>false</SelfContained>
        </PropertyGroup>
        <ItemGroup>
          <ResolvedFileToPublish Include="appsettings.json">
            <RelativePath>appsettings.json</RelativePath>
            <CopyToPublishDirectory>Always</CopyToPublishDirectory>
          </ResolvedFileToPublish>
        </ItemGroup>
        <ProjectExtensions>
          <VisualStudio>
            <UserProperties launchSiteAfterPublish="True" _SavePWD="True" />
          </VisualStudio>
        </ProjectExtensions>
      </Project>
    `);

    expect(parsed.rootTagName).toBe("Project");
    expect(parsed.sections).toHaveLength(4);
    expect(parsed.sections[0]?.title).toBe("PropertyGroup #1");
    expect(parsed.sections[1]?.attributes).toEqual({
      Condition: "'$(Configuration)'=='Debug'",
    });
    expect(parsed.sections[0]?.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "Configuration",
          value: "Release",
        }),
        expect.objectContaining({
          key: "RuntimeIdentifier",
          value: "win-x64",
        }),
        expect.objectContaining({
          key: "PublishDir",
          value: "bin/Release/net8.0/publish/",
        }),
      ])
    );
    expect(parsed.sections[2]?.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "ResolvedFileToPublish",
          attributes: { Include: "appsettings.json" },
        }),
        expect.objectContaining({
          key: "ResolvedFileToPublish › RelativePath",
          value: "appsettings.json",
        }),
      ])
    );
    expect(parsed.sections[3]?.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "VisualStudio › UserProperties",
          attributes: {
            launchSiteAfterPublish: "True",
            _SavePWD: "True",
          },
        }),
      ])
    );
  });

  it("在 XML 非法时抛出错误", () => {
    expect(() =>
      parseProjectPublishProfileXml("<Project><PropertyGroup></Project>")
    ).toThrow();
  });

  it("提取项目发布配置里的 dotnet 参数", () => {
    const parsed = parseProjectPublishProfileXml(`
      <Project>
        <PropertyGroup>
          <Configuration>Release</Configuration>
          <RuntimeIdentifier>win-x64</RuntimeIdentifier>
          <TargetFramework>net8.0</TargetFramework>
          <PublishDir>bin/Release/net8.0/publish/</PublishDir>
          <SelfContained>true</SelfContained>
          <NoBuild>true</NoBuild>
          <NoRestore>true</NoRestore>
          <Verbosity>diagnostic</Verbosity>
          <NoLogo>true</NoLogo>
          <DefineConstants>TRACE;DEMO</DefineConstants>
          <PublishTrimmed>true</PublishTrimmed>
          <DeleteExistingFiles>false</DeleteExistingFiles>
        </PropertyGroup>
      </Project>
    `);

    expect(extractDotnetPublishParametersFromProjectProfile(parsed)).toEqual({
      configuration: "Release",
      runtime: "win-x64",
      framework: "net8.0",
      output: "bin/Release/net8.0/publish/",
      self_contained: true,
      no_build: true,
      no_restore: true,
      verbosity: "diagnostic",
      no_logo: true,
      define: ["TRACE", "DEMO"],
      properties: {
        PublishTrimmed: "true",
        DeleteExistingFiles: "false",
      },
    });
  });
});
