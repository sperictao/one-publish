import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CommandImportDialog } from "@/components/publish/CommandImportDialog";
import type { ProviderManifest } from "@/lib/store/types";

const importFromCommand = vi.hoisted(() => vi.fn());
vi.mock("@/features/publish/publishRuntime", () => ({
  importFromCommand,
}));
vi.mock("@/hooks/useI18n", () => ({ useI18n: () => ({ translations: {} }) }));

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
