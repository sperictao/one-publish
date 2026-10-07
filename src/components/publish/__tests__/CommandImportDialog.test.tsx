import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CommandImportDialog } from "@/components/publish/CommandImportDialog";
import type { ProviderManifest } from "@/lib/store/types";

const { importFromCommand, toastError } = vi.hoisted(() => ({
  importFromCommand: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("@/features/publish/publishRuntime", () => ({
  importFromCommand,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: toastError },
}));
// 只给真实 zh 的 errors 分支：界面文案走组件内中文兜底，错误码文案校验已登记。
vi.mock("@/hooks/useI18n", async () => {
  const zh = (await import("@/i18n/zh.json")).default;
  const translations = { errors: zh.errors };
  return { useI18n: () => ({ translations }) };
});

const provider: ProviderManifest = {
  id: "cargo",
  displayName: "Rust",
  version: "1",
  label: "Rust",
  commandExample: "cargo build --release",
  environmentLabel: "Rust",
  environmentDescription: "cargo",
  requiresProjectBinding: false,
  projectPathKind: "repository_root",
  supportsCommandImport: true,
};
const result = {
  providerId: "cargo",
  parameters: { release: true },
  diagnostics: [
    {
      code: "command_import_unknown_flag",
      message: "unrecognized flag: --not-a-flag (value: x)",
    },
  ],
};

describe("CommandImportDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    importFromCommand.mockResolvedValue(result);
  });

  it("解析当前 Provider 的命令并导入；诊断与参数一起展示", async () => {
    const onImport = vi.fn();
    render(
      <CommandImportDialog
        open
        onOpenChange={vi.fn()}
        providerId="cargo"
        provider={provider}
        projectPath="/repo"
        onImport={onImport}
      />
    );
    fireEvent.change(screen.getByLabelText("构建命令"), {
      target: { value: "cargo build --release --not-a-flag x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "解析命令" }));
    await screen.findByText("提取的参数");
    expect(importFromCommand).toHaveBeenCalledWith({
      command: "cargo build --release --not-a-flag x",
      providerId: "cargo",
      projectPath: "/repo",
    });
    expect(screen.getByText(/解析诊断/)).toBeInTheDocument();
    expect(
      screen.getByText("unrecognized flag: --not-a-flag (value: x)")
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "导入参数" }));
    expect(onImport).toHaveBeenCalledWith(result);
  });

  it("编辑命令后旧结果失效", async () => {
    const onImport = vi.fn();
    render(
      <CommandImportDialog
        open
        onOpenChange={vi.fn()}
        providerId="cargo"
        provider={provider}
        projectPath="/repo"
        onImport={onImport}
      />
    );
    fireEvent.change(screen.getByLabelText("构建命令"), {
      target: { value: "cargo build --release" },
    });
    fireEvent.click(screen.getByRole("button", { name: "解析命令" }));
    await screen.findByText("提取的参数");
    fireEvent.change(screen.getByLabelText("构建命令"), {
      target: { value: "cargo build" },
    });
    expect(screen.getByRole("button", { name: "导入参数" })).toBeDisabled();
    expect(screen.queryByText("提取的参数")).toBeNull();
  });

  it("解析失败按错误码本地化 toast 与内联错误，而不是渲染 [object Object]", async () => {
    // Tauri invoke 以 AppError 对象 reject，而不是 Error 实例。
    importFromCommand.mockRejectedValue({
      kind: "provider",
      message: "failed to load schema",
      details: "schema.json: No such file or directory",
      code: "provider_schema_load_failed",
    });
    render(
      <CommandImportDialog
        open
        onOpenChange={vi.fn()}
        providerId="cargo"
        provider={provider}
        projectPath="/repo"
        onImport={vi.fn()}
      />
    );
    fireEvent.change(screen.getByLabelText("构建命令"), {
      target: { value: "cargo build --release" },
    });
    fireEvent.click(screen.getByRole("button", { name: "解析命令" }));

    const expected =
      "无法加载 Provider 参数定义 | schema.json: No such file or directory";
    expect(await screen.findByText(expected)).toBeInTheDocument();
    expect(toastError).toHaveBeenCalledWith("解析失败", {
      description: expected,
    });
  });

  it("不支持命令导入的 Provider 无法触发解析", () => {
    render(
      <CommandImportDialog
        open
        onOpenChange={vi.fn()}
        providerId="tauri"
        provider={{ ...provider, id: "tauri", supportsCommandImport: false }}
        projectPath="/repo/tauri.conf.json"
        onImport={vi.fn()}
      />
    );
    fireEvent.change(screen.getByLabelText("构建命令"), {
      target: { value: "cargo tauri build" },
    });
    fireEvent.click(screen.getByRole("button", { name: "解析命令" }));
    expect(importFromCommand).not.toHaveBeenCalled();
  });
});
