import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { QuickCreateProfileDialog } from "@/components/publish/QuickCreateProfileDialog";
import type { PublishConfigStore } from "@/lib/store/types";
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
  },
};

const baseConfig: PublishConfigStore = {
  configuration: "Release",
  runtime: "",
  framework: "",
  selfContained: false,
  outputDir: "",
  noBuild: false,
  noRestore: false,
  verbosity: "",
  noLogo: false,
  deleteExistingFiles: false,
  properties: {},
  useProfile: false,
  profileName: "",
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
});

describe("QuickCreateProfileDialog", () => {
  it("保留顶部模板与基础信息区，并把高级字段按 focused 分组为可编辑表单", () => {
    const onDraftChange = vi.fn();

    render(
      <QuickCreateProfileDialog
        open
        quickCreateProfileOpen
        quickCreateTemplateId="custom"
        quickCreateTemplateOptions={[
          {
            id: "custom",
            name: "自定义配置（空表单）",
            description: "从空白表单开始配置",
          },
        ]}
        quickCreateProfileName="My Publish Profile"
        quickCreateProfileGroup="默认分组"
        quickCreateProfileGroupOptions={["默认分组", "项目发布配置"]}
        quickCreateProfileCustomGroup=""
        quickCreateProfileDraft={{ kind: "dotnet", config: baseConfig }}
        projectFrameworkOptions={["net8.0", "net9.0"]}
        quickCreateProfileSaving={false}
        quickCreateEditing={false}
        dotnetSchema={dotnetSchema}
        providerSchemas={{ dotnet: dotnetSchema }}
        quickCreateGroupDefaultValue="默认分组"
        quickCreateGroupCustomValue="__custom__"
        profileT={{
          quickCreateTemplate: "预置模板",
          quickCreateBasicSection: "基础信息",
          quickCreateName: "配置名称",
          quickCreateGroup: "发布配置组",
          quickCreateParametersSection: "发布参数",
          quickCreateOutputSection: "输出与部署",
          quickCreateAdvancedSection: "高级参数",
          quickCreateAdditionalSection: "其余参数",
        }}
        appT={{
          configurationType: "配置类型",
          runtimeLabel: "运行时",
          outputDirLabel: "输出目录",
          frameworkDependent: "框架依赖",
          selfContained: "自包含部署",
        }}
        cancelLabel="取消"
        onOpenChange={() => {}}
        onApplyTemplate={() => {}}
        onProfileNameChange={() => {}}
        onProfileGroupChange={() => {}}
        onProfileCustomGroupChange={() => {}}
        onDraftChange={onDraftChange}
        onParameterChange={vi.fn()}
        onSave={() => {}}
      />
    );

    expect(screen.getByText("预置模板")).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "配置名称" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "发布配置组" })
    ).toBeInTheDocument();
    expect(screen.getByText("发布参数")).toBeInTheDocument();
    expect(screen.getByText("输出与部署")).toBeInTheDocument();
    expect(screen.getByText("高级参数")).toBeInTheDocument();

    const frameworkInput = screen.getByLabelText("目标框架");
    expect(frameworkInput).toHaveAttribute("list");
    expect(
      screen.getByRole("switch", { name: "发布前清空目标目录" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "上次使用的构建配置" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "发布提供程序" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "目标 ID" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("switch", { name: "跳过构建" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "日志详细级别" })
    ).not.toBeInTheDocument();

    fireEvent.change(frameworkInput, {
      target: { value: "net9.0" },
    });

    expect(onDraftChange).toHaveBeenCalledWith({
      framework: "net9.0",
    });

    fireEvent.click(screen.getByRole("switch", { name: "发布前清空目标目录" }));

    expect(onDraftChange).toHaveBeenCalledWith({
      deleteExistingFiles: true,
    });

    fireEvent.click(screen.getByRole("button", { name: /其余参数/ }));

    expect(
      screen.queryByRole("textbox", { name: "目标 ID" })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: "跳过构建" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "日志详细级别" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: "单文件发布" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "条件编译常量" })
    ).not.toBeInTheDocument();
    expect(screen.getByText("-p:")).toBeInTheDocument();
  });

  it("schema 草稿按 Provider 参数定义渲染表单，隐藏 dotnet 模板卡", () => {
    const onParameterChange = vi.fn();
    const cargoSchema: ParameterSchema = {
      parameters: {
        target: { type: "string", flag: "--target" },
        release: { type: "boolean", flag: "--release" },
      },
    };

    render(
      <QuickCreateProfileDialog
        open
        quickCreateProfileOpen
        quickCreateTemplateId="custom"
        quickCreateTemplateOptions={[]}
        quickCreateProfileName="Cargo Nightly"
        quickCreateProfileGroup="默认分组"
        quickCreateProfileGroupOptions={[]}
        quickCreateProfileCustomGroup=""
        quickCreateProfileDraft={{
          kind: "schema",
          providerId: "cargo",
          parameters: { target: "aarch64-apple-darwin" },
        }}
        projectFrameworkOptions={[]}
        quickCreateProfileSaving={false}
        quickCreateEditing
        dotnetSchema={dotnetSchema}
        providerSchemas={{ dotnet: dotnetSchema, cargo: cargoSchema }}
        quickCreateGroupDefaultValue="默认分组"
        quickCreateGroupCustomValue="__custom__"
        profileT={{}}
        appT={{}}
        cancelLabel="取消"
        onOpenChange={vi.fn()}
        onApplyTemplate={vi.fn()}
        onProfileNameChange={vi.fn()}
        onProfileGroupChange={vi.fn()}
        onProfileCustomGroupChange={vi.fn()}
        onDraftChange={vi.fn()}
        onParameterChange={onParameterChange}
        onSave={vi.fn()}
      />
    );

    // dotnet 专属模板卡与表单不出现
    expect(screen.queryByText("快速套用模板")).not.toBeInTheDocument();
    expect(screen.queryByText("高级参数")).not.toBeInTheDocument();

    // schema 字段渲染并携带既有值
    expect(screen.getByLabelText("target")).toHaveValue("aarch64-apple-darwin");

    fireEvent.click(screen.getByLabelText("release"));
    expect(onParameterChange).toHaveBeenCalledWith("release", true);
  });

  it("查看态以只读呈现 schema 表单，隐藏基础信息与保存入口", () => {
    const onParameterChange = vi.fn();
    const cargoSchema: ParameterSchema = {
      parameters: {
        target: { type: "string", flag: "--target" },
      },
    };

    render(
      <QuickCreateProfileDialog
        open
        quickCreateProfileOpen
        quickCreateTemplateId="custom"
        quickCreateTemplateOptions={[]}
        quickCreateProfileName="Cargo Nightly"
        quickCreateProfileGroup="默认分组"
        quickCreateProfileGroupOptions={[]}
        quickCreateProfileCustomGroup=""
        quickCreateProfileDraft={{
          kind: "schema",
          providerId: "cargo",
          parameters: { target: "aarch64-apple-darwin" },
        }}
        projectFrameworkOptions={[]}
        quickCreateProfileSaving={false}
        quickCreateEditing
        quickCreateViewing
        dotnetSchema={dotnetSchema}
        providerSchemas={{ cargo: cargoSchema }}
        quickCreateGroupDefaultValue="默认分组"
        quickCreateGroupCustomValue="__custom__"
        profileT={{ quickViewTitle: "查看发布配置" }}
        appT={{}}
        cancelLabel="关闭"
        onOpenChange={vi.fn()}
        onApplyTemplate={vi.fn()}
        onProfileNameChange={vi.fn()}
        onProfileGroupChange={vi.fn()}
        onProfileCustomGroupChange={vi.fn()}
        onDraftChange={vi.fn()}
        onParameterChange={onParameterChange}
        onSave={vi.fn()}
      />
    );

    expect(screen.getByText("查看发布配置")).toBeInTheDocument();
    // 基础信息编辑区与保存按钮不出现
    expect(screen.queryByLabelText("配置名称")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /保存修改|创建并保存/ })
    ).not.toBeInTheDocument();

    const target = screen.getByLabelText("target");
    expect(target).toHaveValue("aarch64-apple-darwin");
    expect(target).toHaveAttribute("readonly");
  });
});
