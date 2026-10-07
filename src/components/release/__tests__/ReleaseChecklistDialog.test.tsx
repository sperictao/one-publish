import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ReleaseChecklistDialog } from "@/components/release/ReleaseChecklistDialog";

const mocks = vi.hoisted(() => ({
  getUpdaterConfigHealth: vi.fn(),
  exportPreflightReport: vi.fn(),
  save: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: mocks.save }));
vi.mock("@/lib/store/api", () => ({
  getUpdaterConfigHealth: mocks.getUpdaterConfigHealth,
}));
vi.mock("@/lib/preflight", () => ({
  exportPreflightReport: mocks.exportPreflightReport,
}));

// 用真实 zh 文案，顺带校验后端错误码已在 `errors.<code>` 登记。
vi.mock("@/hooks/useI18n", async () => {
  const zh = (await import("@/i18n/zh.json")).default;
  return { useI18n: () => ({ translations: zh }) };
});

function renderDialog() {
  render(
    <ReleaseChecklistDialog
      open
      onOpenChange={vi.fn()}
      publishResult={null}
      environmentResult={null}
      packageResult={null}
      signResult={null}
    />
  );
}

describe("ReleaseChecklistDialog 错误展示", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.save.mockResolvedValue("/tmp/preflight-report.md");
  });

  it("updater 检测失败时展示并导出可读错误，导出失败时用错误码文案", async () => {
    // Tauri invoke 以 AppError 对象 reject，而不是 Error 实例。
    mocks.getUpdaterConfigHealth.mockRejectedValue({
      kind: "updater",
      message: "updater plugin is not initialized",
    });
    mocks.exportPreflightReport.mockRejectedValue({
      kind: "export",
      message: "write error",
      details: "Permission denied (os error 13)",
      code: "preflight_report_write_failed",
    });
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: /Updater 配置/ }));
    expect(
      await screen.findByText("updater plugin is not initialized")
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "导出预检报告" }));

    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("导出预检报告失败", {
        description: "无法写入预检报告文件 | Permission denied (os error 13)",
      })
    );
    expect(mocks.exportPreflightReport).toHaveBeenCalledWith({
      filePath: "/tmp/preflight-report.md",
      report: expect.objectContaining({
        updater: { health: null, error: "updater plugin is not initialized" },
      }),
    });
  });
});
