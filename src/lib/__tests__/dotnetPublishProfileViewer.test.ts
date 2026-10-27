import { describe, expect, it } from "vitest";

import { buildProjectPublishProfileSupplementSections } from "@/lib/dotnetPublishProfileViewer";
import { parseProjectPublishProfileXml } from "@/lib/projectPublishProfileXml";

describe("buildProjectPublishProfileSupplementSections", () => {
  it("过滤主表单已表达的平铺 PropertyGroup 字段，并保留结构化补充信息", () => {
    const parsedProfile = parseProjectPublishProfileXml(`
      <Project>
        <PropertyGroup Condition="'$(Configuration)'=='Release'">
          <Configuration>Release</Configuration>
          <PublishDir>/tmp/publish</PublishDir>
          <PublishUrl>/tmp/publish</PublishUrl>
          <PublishSingleFile>true</PublishSingleFile>
          <PublishItems>
            <ResolvedFileToPublish Include="wwwroot/appsettings.json">
              <RelativePath>appsettings.json</RelativePath>
            </ResolvedFileToPublish>
          </PublishItems>
        </PropertyGroup>
        <ItemGroup>
          <ResolvedFileToPublish Include="appsettings.json">
            <CopyToPublishDirectory>Always</CopyToPublishDirectory>
          </ResolvedFileToPublish>
        </ItemGroup>
      </Project>
    `);

    const sections =
      buildProjectPublishProfileSupplementSections(parsedProfile);

    expect(sections).toHaveLength(2);
    expect(sections[0]?.tagName).toBe("PropertyGroup");
    expect(sections[0]?.attributes).toEqual({
      Condition: "'$(Configuration)'=='Release'",
    });
    expect(sections[0]?.entries).toEqual([
      expect.objectContaining({
        key: "PublishUrl",
        path: "PublishUrl",
        value: "/tmp/publish",
      }),
      expect.objectContaining({
        key: "PublishItems › ResolvedFileToPublish",
        path: "PublishItems.ResolvedFileToPublish",
        attributes: {
          Include: "wwwroot/appsettings.json",
        },
      }),
      expect.objectContaining({
        key: "PublishItems › ResolvedFileToPublish › RelativePath",
        path: "PublishItems.ResolvedFileToPublish.RelativePath",
        value: "appsettings.json",
      }),
    ]);
    expect(sections[1]?.tagName).toBe("ItemGroup");
    expect(sections[1]?.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "ResolvedFileToPublish",
          path: "ResolvedFileToPublish",
          attributes: {
            Include: "appsettings.json",
          },
        }),
      ])
    );
  });

  it("补充区保留空值、带属性与无法映射为发布参数的平铺条目", () => {
    const parsedProfile = parseProjectPublishProfileXml(`
      <Project>
        <PropertyGroup>
          <ReservedSlot />
          <PublishUrl Condition="'$(Environment)'=='Prod'">/tmp/prod</PublishUrl>
          <SelfContained>maybe</SelfContained>
        </PropertyGroup>
      </Project>
    `);

    const sections =
      buildProjectPublishProfileSupplementSections(parsedProfile);

    // 空值（表单无可填字段）、携带属性的元素、以及无法解析为布尔的
    // SelfContained 都不能由主表单表达——全部按原顺序进入补充区。
    expect(sections).toHaveLength(1);
    expect(sections[0]?.entries.map((entry) => entry.path)).toEqual([
      "ReservedSlot",
      "PublishUrl",
      "SelfContained",
    ]);
    expect(sections[0]?.entries[1]?.attributes).toEqual({
      Condition: "'$(Environment)'=='Prod'",
    });
  });

  it("仅含直接映射字段且无任何补充属性时省略整个 PropertyGroup", () => {
    // 与「返回空补充区」互补：properties 完全缺省时 normalize 必须容忍
    // undefined，同时全部布尔/文本直接映射键走 isDirectlyMapped 臂。
    const parsedProfile = parseProjectPublishProfileXml(`
      <Project>
        <PropertyGroup>
          <Configuration>Release</Configuration>
          <TargetFramework>net8.0</TargetFramework>
          <SelfContained>true</SelfContained>
          <NoBuild>false</NoBuild>
          <NoRestore>true</NoRestore>
          <NoLogo>true</NoLogo>
          <MSBuildVerbosity>normal</MSBuildVerbosity>
        </PropertyGroup>
      </Project>
    `);

    expect(buildProjectPublishProfileSupplementSections(parsedProfile)).toEqual(
      []
    );
  });

  it("同名 verbosity 主键被后写条目覆盖时，漂移值保留为补充信息", () => {
    const parsedProfile = parseProjectPublishProfileXml(`
      <Project>
        <PropertyGroup>
          <Verbosity>minimal</Verbosity>
          <MSBuildVerbosity>normal</MSBuildVerbosity>
        </PropertyGroup>
      </Project>
    `);

    const sections =
      buildProjectPublishProfileSupplementSections(parsedProfile);

    // parameters.verbosity 由后者 normal 决定：主表单表达的是 normal，
    // 漂移的 Verbosity=minimal 必须留在补充区，而 MSBuildVerbosity 被过滤。
    expect(sections).toHaveLength(1);
    expect(sections[0]?.entries.map((entry) => entry.path)).toEqual([
      "Verbosity",
    ]);
  });

  it("当 pubxml 信息都能被主表单表达时返回空补充区", () => {
    const parsedProfile = parseProjectPublishProfileXml(`
      <Project>
        <PropertyGroup>
          <Configuration>Release</Configuration>
          <RuntimeIdentifier>win-x64</RuntimeIdentifier>
          <PublishDir>/tmp/publish</PublishDir>
          <PublishSingleFile>true</PublishSingleFile>
        </PropertyGroup>
      </Project>
    `);

    expect(buildProjectPublishProfileSupplementSections(parsedProfile)).toEqual(
      []
    );
  });
});
