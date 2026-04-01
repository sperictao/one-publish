import { describe, expect, it } from "vitest";

import { buildProjectPublishProfileSupplementSections } from "@/lib/dotnetPublishProfileViewer";
import { parseProjectPublishProfileXml } from "@/lib/projectPublishProfileXml";

describe("buildProjectPublishProfileSupplementSections", () => {
  it("过滤主表单已表达的平铺 PropertyGroup 字段，并保留结构化补充信息", () => {
    const parsedProfile = parseProjectPublishProfileXml(`
      <Project>
        <PropertyGroup Condition="'$(Configuration)'=='Release'">
          <Configuration>Release</Configuration>
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

    const sections = buildProjectPublishProfileSupplementSections(parsedProfile);

    expect(sections).toHaveLength(2);
    expect(sections[0]?.tagName).toBe("PropertyGroup");
    expect(sections[0]?.attributes).toEqual({
      Condition: "'$(Configuration)'=='Release'",
    });
    expect(sections[0]?.entries).toEqual([
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
