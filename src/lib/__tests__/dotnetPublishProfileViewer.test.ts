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

  it("空白 path 的 PropertyGroup 条目被过滤", () => {
    const sections = buildProjectPublishProfileSupplementSections({
      sections: [
        {
          tagName: "PropertyGroup",
          attributes: {},
          entries: [
            { key: "", path: "   ", value: "x", attributes: {} },
            {
              key: "Item.Group",
              path: "Item.Group",
              value: "keep",
              attributes: {},
            },
          ],
        },
      ],
    } as never);

    expect(sections[0]?.entries.map((e) => e.path)).toEqual(["Item.Group"]);
  });
});

describe("buildProjectPublishProfileSupplementSections 属性名大小写归一", () => {
  it("全小写属性名已被主表单映射时不再重复出现在补充区", () => {
    const parsedProfile = parseProjectPublishProfileXml(`
      <Project>
        <PropertyGroup>
          <configuration>Release</configuration>
        </PropertyGroup>
      </Project>
    `);

    expect(buildProjectPublishProfileSupplementSections(parsedProfile)).toEqual(
      []
    );
  });

  it("全大写与混合大小写属性名同样不重复出现在补充区", () => {
    // 每个属性只出现一次：同名变体相互覆盖时，漂移值按既有契约应留在
    // 补充区（见下方 verbosity 守卫），不在此用例的讨论范围内。
    const parsedProfile = parseProjectPublishProfileXml(`
      <Project>
        <PropertyGroup>
          <CONFIGURATION>Release</CONFIGURATION>
          <RuNtImEiDeNtIfIeR>win-x64</RuNtImEiDeNtIfIeR>
          <TARGETFRAMEWORK>net8.0</TARGETFRAMEWORK>
        </PropertyGroup>
      </Project>
    `);

    expect(buildProjectPublishProfileSupplementSections(parsedProfile)).toEqual(
      []
    );
  });

  it("布尔与 verbosity 属性的大小写变体同样由主表单表达", () => {
    const parsedProfile = parseProjectPublishProfileXml(`
      <Project>
        <PropertyGroup>
          <selfcontained>true</selfcontained>
          <NOLOGO>true</NOLOGO>
          <msbuildverbosity>quiet</msbuildverbosity>
          <publishdir>/tmp/publish</publishdir>
        </PropertyGroup>
      </Project>
    `);

    expect(buildProjectPublishProfileSupplementSections(parsedProfile)).toEqual(
      []
    );
  });

  it("归一后仍保留 verbosity 漂移值，标准拼写路径行为不变", () => {
    const parsedProfile = parseProjectPublishProfileXml(`
      <Project>
        <PropertyGroup>
          <VERBOSITY>minimal</VERBOSITY>
          <msbuildverbosity>quiet</msbuildverbosity>
        </PropertyGroup>
      </Project>
    `);

    const sections =
      buildProjectPublishProfileSupplementSections(parsedProfile);

    // parameters.verbosity 由后者 quiet 决定；漂移的 VERBOSITY=minimal
    // 必须留在补充区，小写 msbuildverbosity 则被直接映射过滤。
    expect(sections[0]?.entries.map((entry) => entry.path)).toEqual([
      "VERBOSITY",
    ]);
  });

  it("守卫：标准拼写与不支持属性过滤行为不因归一而改变", () => {
    const parsedProfile = parseProjectPublishProfileXml(`
      <Project>
        <PropertyGroup>
          <Configuration>Release</Configuration>
          <PublishUrl>/tmp/publish</PublishUrl>
          <myCustomFlag>on</myCustomFlag>
        </PropertyGroup>
      </Project>
    `);

    const sections =
      buildProjectPublishProfileSupplementSections(parsedProfile);

    expect(sections[0]?.entries.map((entry) => entry.path)).toEqual([
      "PublishUrl",
    ]);
  });
});
