import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { QuickCreateProfileDialog } from "@/components/publish/QuickCreateProfileDialog";
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
  it("dotnet 草稿与其他 Provider 一致走 schema 表单，保留模板与基础信息区", () => {
    const onParameterChange = vi.fn();

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
        quickCreateProfileDraft={{
          providerId: "dotnet",
          parameters: { configuration: "Release", self_contained: true },
        }}
        quickCreateProfileSaving={false}
        quickCreateEditing={false}
        providerSchemas={{ dotnet: dotnetSchema }}
        quickCreateGroupDefaultValue="默认分组"
        quickCreateGroupCustomValue="__custom__"
        profileT={{
          quickCreateTemplate: "预置模板",
          quickCreateBasicSection: "基础信息",
          quickCreateName: "配置名称",
          quickCreateGroup: "发布配置组",
        }}
        cancelLabel="取消"
        onOpenChange={() => {}}
        onApplyTemplate={() => {}}
        onProfileNameChange={() => {}}
        onProfileGroupChange={() => {}}
        onProfileCustomGroupChange={() => {}}
        onParameterChange={onParameterChange}
        onSave={() => {}}
      />
    );

    // dotnet 仍显示模板卡与基础信息区
    expect(screen.getByText("预置模板")).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "配置名称" })
    ).toBeInTheDocument();

    // 表单即 schema 表单：字段按 dotnet 参数定义渲染并携带现值
    expect(screen.getByLabelText("configuration")).toHaveValue("Release");
    expect(screen.getByLabelText("self_contained")).toBeChecked();
    expect(screen.getByLabelText("runtime")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("framework"), {
      target: { value: "net9.0" },
    });
    expect(onParameterChange).toHaveBeenCalledWith("framework", "net9.0");
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
          providerId: "cargo",
          parameters: { target: "aarch64-apple-darwin" },
        }}
        quickCreateProfileSaving={false}
        quickCreateEditing
        providerSchemas={{ dotnet: dotnetSchema, cargo: cargoSchema }}
        quickCreateGroupDefaultValue="默认分组"
        quickCreateGroupCustomValue="__custom__"
        profileT={{}}
        cancelLabel="取消"
        onOpenChange={vi.fn()}
        onApplyTemplate={vi.fn()}
        onProfileNameChange={vi.fn()}
        onProfileGroupChange={vi.fn()}
        onProfileCustomGroupChange={vi.fn()}
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
          providerId: "cargo",
          parameters: { target: "aarch64-apple-darwin" },
        }}
        quickCreateProfileSaving={false}
        quickCreateEditing
        quickCreateViewing
        providerSchemas={{ cargo: cargoSchema }}
        quickCreateGroupDefaultValue="默认分组"
        quickCreateGroupCustomValue="__custom__"
        profileT={{ quickViewTitle: "查看发布配置" }}
        cancelLabel="关闭"
        onOpenChange={vi.fn()}
        onApplyTemplate={vi.fn()}
        onProfileNameChange={vi.fn()}
        onProfileGroupChange={vi.fn()}
        onProfileCustomGroupChange={vi.fn()}
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
