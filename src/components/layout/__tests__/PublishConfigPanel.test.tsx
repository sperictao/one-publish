import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PublishConfigPanel } from "@/components/layout/PublishConfigPanel";
import { __setTranslationsCacheForTest } from "@/hooks/useI18n";
import type { ConfigProfile, PublishConfigStore } from "@/lib/store";
import type { ParameterSchema } from "@/types/parameters";

const { resolveDotnetProjectProfileMock } = vi.hoisted(() => ({
  resolveDotnetProjectProfileMock: vi.fn(),
}));

vi.mock("@/lib/dotnetProjectProfile", () => ({
  resolveDotnetProjectProfile: resolveDotnetProjectProfileMock,
}));

function createProfile(name: string): ConfigProfile {
  return {
    name,
    providerId: "dotnet",
    parameters: {},
    createdAt: new Date().toISOString(),
    isSystemDefault: false,
  };
}

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

beforeAll(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation(() => ({
      matches: false,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  );

  if (typeof PointerEvent === "undefined") {
    vi.stubGlobal("PointerEvent", MouseEvent);
  }

  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );

  if (!HTMLElement.prototype.getAnimations) {
    Object.defineProperty(HTMLElement.prototype, "getAnimations", {
      value: () => [],
    });
  }

  if (!HTMLElement.prototype.animate) {
    Object.defineProperty(HTMLElement.prototype, "animate", {
      value: () => ({
        cancel() {},
      }),
    });
  }

  __setTranslationsCacheForTest({
    zh: {
      repositoryList: {
        all: "全部",
        moreActions: "更多操作",
      },
      configPanel: {
        allConfigs: "全部",
        profileGroup: "项目发布配置",
        moreActions: "更多操作",
        recentlyUsed: "最近使用",
        favoriteConfig: "收藏配置",
        unfavoriteConfig: "取消收藏",
        removeRecent: "从最近使用移除",
        deleteConfig: "删除配置",
        editConfig: "编辑配置",
        searchConfig: "搜索配置",
      },
    },
  });
});

beforeEach(() => {
  localStorage.setItem("app-language", "zh");
  resolveDotnetProjectProfileMock.mockReset();
});

describe("PublishConfigPanel", () => {
  it("打开未选中配置菜单时不会误选中，并在离开列表后仍锁定菜单上下文", async () => {
    const onSelectProfile = vi.fn();
    const onSelectProjectProfile = vi.fn();
    const onRemoveRecentConfig = vi.fn();
    const profiles = [createProfile("alpha-profile"), createProfile("beta-profile")];

    const { container } = render(
      <PublishConfigPanel
        selectedPreset="release-fd"
        isCustomMode={true}
        profiles={profiles}
        activeProfileName="alpha-profile"
        onSelectProfile={onSelectProfile}
        onCreateProfile={() => {}}
        onEditProfile={() => {}}
        onRefreshProfiles={() => {}}
        onOpenConfigDialog={() => {}}
        onDeleteProfile={() => {}}
        dotnetSchema={dotnetSchema}
        projectPublishProfiles={[]}
        onSelectProjectProfile={onSelectProjectProfile}
        onCopyProjectProfileToCustom={async (_name, _config: PublishConfigStore) => "copied"}
        recentConfigKeys={["userprofile:beta-profile"]}
        favoriteConfigKeys={[]}
        onToggleFavoriteConfig={() => {}}
        onRemoveRecentConfig={onRemoveRecentConfig}
      />
    );

    const recentRow = container.querySelector<HTMLElement>(
      '[data-list-item-id="recent:userprofile:beta-profile"]'
    );
    expect(recentRow).not.toBeNull();

    const list = container.querySelector<HTMLElement>(".list-scroll-shell");
    expect(list).not.toBeNull();

    fireEvent.pointerEnter(list!);
    fireEvent.mouseOver(recentRow!);

    await waitFor(() => {
      expect(recentRow).toHaveAttribute("data-list-visual-target", "true");
    });

    const trigger = within(recentRow!).getByRole("button", {
      name: "更多操作: beta-profile",
    });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);

    await waitFor(() => {
      expect(recentRow).toHaveAttribute("data-list-menu-open", "true");
    });

    const removeRecentItem = await screen.findByRole("menuitem", {
      name: "从最近使用移除",
    });

    expect(onSelectProfile).not.toHaveBeenCalled();
    expect(onSelectProjectProfile).not.toHaveBeenCalled();

    fireEvent.pointerLeave(list!);

    expect(recentRow).toHaveAttribute("data-list-menu-open", "true");
    expect(recentRow).toHaveAttribute("data-list-visual-target", "true");

    fireEvent.click(removeRecentItem);

    await waitFor(() => {
      expect(onRemoveRecentConfig).toHaveBeenCalledWith("userprofile:beta-profile");
    });
    expect(onSelectProfile).not.toHaveBeenCalled();
    expect(onSelectProjectProfile).not.toHaveBeenCalled();
  });

  it("项目发布配置查看页保持只读表单一致，并在补充区展示未映射的 pubxml 信息", async () => {
    resolveDotnetProjectProfileMock.mockResolvedValue({
      profileName: "FolderProfile",
      filePath: "/repo/Properties/PublishProfiles/FolderProfile.pubxml",
      parsedProfile: {
        rootTagName: "Project",
        sections: [
          {
            id: "PropertyGroup-1",
            title: "PropertyGroup",
            tagName: "PropertyGroup",
            path: "PropertyGroup",
            attributes: {
              Condition: "'$(Configuration)'=='Release'",
            },
            entries: [
              {
                key: "Configuration",
                path: "Configuration",
                value: "Release",
                attributes: {},
              },
              {
                key: "PublishDir",
                path: "PublishDir",
                value: "/tmp/publish",
                attributes: {},
              },
            ],
          },
          {
            id: "ItemGroup-1",
            title: "ItemGroup",
            tagName: "ItemGroup",
            path: "ItemGroup",
            attributes: {},
            entries: [
              {
                key: "PublishItems › ResolvedFileToPublish",
                path: "PublishItems.ResolvedFileToPublish",
                value: "Never",
                attributes: {
                  Include: "wwwroot/appsettings.json",
                },
              },
            ],
          },
        ],
        rawXml: "<Project />",
      },
      parameters: {
        configuration: "Release",
      },
      editableConfig: {
        configuration: "Release",
        runtime: "win-x64",
        framework: "net8.0",
        selfContained: true,
        outputDir: "/tmp/publish",
        noBuild: false,
        noRestore: false,
        verbosity: "",
        noLogo: false,
        properties: {
          DeleteExistingFiles: "true",
          PublishProvider: "FileSystem",
          ProjectGuid: "{12345678-1234-1234-1234-1234567890AB}",
          _TargetId: "Folder",
          PublishSingleFile: "true",
        },
        define: [],
        useProfile: false,
        profileName: "",
      },
    });

    const { container } = render(
      <PublishConfigPanel
        selectedPreset="release-fd"
        isCustomMode={false}
        profiles={[]}
        activeProfileName={null}
        onSelectProfile={() => {}}
        onCreateProfile={() => {}}
        onEditProfile={() => {}}
        onRefreshProfiles={() => {}}
        onOpenConfigDialog={() => {}}
        onDeleteProfile={() => {}}
        dotnetSchema={dotnetSchema}
        projectPublishProfiles={["FolderProfile"]}
        projectFilePath="/repo/Project.csproj"
        projectFrameworkOptions={["net8.0", "net9.0"]}
        onSelectProjectProfile={() => {}}
        onCopyProjectProfileToCustom={async (_name, _config: PublishConfigStore) => "copied"}
        recentConfigKeys={[]}
        favoriteConfigKeys={[]}
        onToggleFavoriteConfig={() => {}}
        onRemoveRecentConfig={() => {}}
      />
    );

    const projectRow = container.querySelector<HTMLElement>(
      '[data-list-item-id="pubxml:FolderProfile"]'
    );
    expect(projectRow).not.toBeNull();

    const trigger = within(projectRow!).getByRole("button", {
      name: "更多操作: FolderProfile",
    });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);

    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "查看配置",
      })
    );

    await waitFor(() => {
      expect(resolveDotnetProjectProfileMock).toHaveBeenCalledWith({
        projectInfo: {
          root_path: "",
          project_file: "/repo/Project.csproj",
          target_frameworks: ["net8.0", "net9.0"],
        },
        profileName: "FolderProfile",
      });
    });

    expect(await screen.findByText("发布参数")).toBeInTheDocument();
    expect(screen.getByText("输出与部署")).toBeInTheDocument();
    expect(screen.getByText("高级参数")).toBeInTheDocument();
    expect(screen.getByText("/repo/Properties/PublishProfiles/FolderProfile.pubxml")).toBeInTheDocument();
    expect(screen.queryByText("dotnet publish 参数")).not.toBeInTheDocument();
    expect(screen.queryByText("发布相关 MSBuild 属性")).not.toBeInTheDocument();
    expect(screen.queryByText("配置文件参数统计")).not.toBeInTheDocument();
    expect(screen.queryByText("PublishItems › ResolvedFileToPublish")).not.toBeInTheDocument();
    expect(screen.queryByText("原始配置文件")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "主表单与新建、编辑配置保持一致；其余无法在表单里完整表达的 .pubxml 信息收起在下方补充区中。"
      )
    ).toBeInTheDocument();

    expect(
      screen.getByRole("combobox", {
        name: "配置类型",
      })
    ).toBeDisabled();
    expect(
      screen.getByRole("textbox", {
        name: "输出目录",
      })
    ).toHaveAttribute("readonly");
    expect(
      screen.getByRole("switch", {
        name: "自包含部署",
      })
    ).toBeDisabled();
    expect(screen.queryByRole("button", { name: /remove item/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remove entry/i })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "目标框架" })).toHaveValue("net8.0");
    expect(screen.getByRole("switch", { name: "发布前清空目标目录" })).toBeChecked();
    expect(
      screen.getByRole("combobox", { name: "上次使用的构建配置" })
    ).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "发布提供程序" })).toHaveValue("FileSystem");
    expect(
      screen.getAllByRole("switch", { name: "发布前清空目标目录" })
    ).toHaveLength(1);
    expect(screen.queryByRole("textbox", { name: "目标 ID" })).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: /其余参数/,
      })
    );

    expect(screen.getByRole("textbox", { name: "目标 ID" })).toHaveValue("Folder");
    expect(screen.getByRole("switch", { name: "单文件发布" })).toBeChecked();
    expect(screen.getByRole("combobox", { name: "日志详细级别" })).toBeDisabled();
    expect(screen.getByText("当前未设置条件编译常量。")).toBeInTheDocument();

    const parsedFieldsToggle = screen.getByRole("button", {
      name: /完整解析参数/,
    });
    fireEvent.click(parsedFieldsToggle);

    expect(screen.getByText("PropertyGroup")).toBeInTheDocument();
    expect(screen.getByText("标签: PropertyGroup")).toBeInTheDocument();
    expect(screen.getByText("Condition")).toBeInTheDocument();
    expect(screen.getByText("'$(Configuration)'=='Release'")).toBeInTheDocument();
    expect(
      screen.getByText("PublishItems › ResolvedFileToPublish")
    ).toBeInTheDocument();
    expect(
      screen.getByText("PublishItems.ResolvedFileToPublish")
    ).toBeInTheDocument();
    expect(screen.getByText("Never")).toBeInTheDocument();
  });

  it("项目发布配置完全可映射时不显示补充折叠区", async () => {
    resolveDotnetProjectProfileMock.mockResolvedValue({
      profileName: "ReleaseProfile",
      filePath: "/repo/Properties/PublishProfiles/ReleaseProfile.pubxml",
      parsedProfile: {
        rootTagName: "Project",
        rawXml: "<Project />",
        sections: [
          {
            id: "PropertyGroup-1",
            title: "PropertyGroup",
            tagName: "PropertyGroup",
            path: "PropertyGroup",
            attributes: {},
            entries: [
              {
                key: "Configuration",
                path: "Configuration",
                value: "Release",
                attributes: {},
              },
              {
                key: "RuntimeIdentifier",
                path: "RuntimeIdentifier",
                value: "win-x64",
                attributes: {},
              },
              {
                key: "PublishDir",
                path: "PublishDir",
                value: "/tmp/publish",
                attributes: {},
              },
              {
                key: "PublishSingleFile",
                path: "PublishSingleFile",
                value: "true",
                attributes: {},
              },
            ],
          },
        ],
      },
      parameters: {
        configuration: "Release",
      },
      editableConfig: {
        configuration: "Release",
        runtime: "win-x64",
        framework: "",
        selfContained: false,
        outputDir: "/tmp/publish",
        noBuild: false,
        noRestore: false,
        verbosity: "",
        noLogo: false,
        properties: {
          PublishSingleFile: "true",
        },
        define: [],
        useProfile: false,
        profileName: "",
      },
    });

    const { container } = render(
      <PublishConfigPanel
        selectedPreset="release-fd"
        isCustomMode={false}
        profiles={[]}
        activeProfileName={null}
        onSelectProfile={() => {}}
        onCreateProfile={() => {}}
        onEditProfile={() => {}}
        onRefreshProfiles={() => {}}
        onOpenConfigDialog={() => {}}
        onDeleteProfile={() => {}}
        dotnetSchema={dotnetSchema}
        projectPublishProfiles={["ReleaseProfile"]}
        projectFilePath="/repo/Project.csproj"
        projectFrameworkOptions={["net8.0"]}
        onSelectProjectProfile={() => {}}
        onCopyProjectProfileToCustom={async (_name, _config: PublishConfigStore) => "copied"}
        recentConfigKeys={[]}
        favoriteConfigKeys={[]}
        onToggleFavoriteConfig={() => {}}
        onRemoveRecentConfig={() => {}}
      />
    );

    const projectRow = container.querySelector<HTMLElement>(
      '[data-list-item-id="pubxml:ReleaseProfile"]'
    );
    expect(projectRow).not.toBeNull();

    const trigger = within(projectRow!).getByRole("button", {
      name: "更多操作: ReleaseProfile",
    });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);

    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "查看配置",
      })
    );

    await screen.findByText("发布参数");

    expect(
      screen.queryByRole("button", {
        name: /完整解析参数/,
      })
    ).not.toBeInTheDocument();
  });
});
