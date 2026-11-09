import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
      await screen.findByText("updater plugin is not initialized | [updater]")
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
        updater: {
          health: null,
          error: "updater plugin is not initialized | [updater]",
        },
      }),
    });
  });

  it("关闭再打开后，迟到响应不得覆盖新一轮检测结果", async () => {
    const deferred = <T,>() => {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((res) => {
        resolve = res;
      });
      return { promise, resolve };
    };
    const stale = deferred<{ configured: boolean; message: string }>();
    const fresh = deferred<{ configured: boolean; message: string }>();
    mocks.getUpdaterConfigHealth
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(fresh.promise);

    const props = {
      onOpenChange: vi.fn(),
      publishResult: null,
      environmentResult: null,
      packageResult: null,
      signResult: null,
    };
    const { rerender } = render(<ReleaseChecklistDialog open {...props} />);
    expect(mocks.getUpdaterConfigHealth).toHaveBeenCalledTimes(1);

    rerender(<ReleaseChecklistDialog open={false} {...props} />);
    rerender(<ReleaseChecklistDialog open {...props} />);
    expect(mocks.getUpdaterConfigHealth).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: /Updater 配置/ }));

    // 第一轮的迟到响应必须被丢弃：既不渲染其文案，也不把 loading 清掉。
    await act(async () => {
      stale.resolve({ configured: true, message: "stale-updater-message" });
      await stale.promise;
    });
    expect(screen.queryByText("stale-updater-message")).not.toBeInTheDocument();
    expect(screen.getByText(/正在检测 updater 配置/)).toBeInTheDocument();

    await act(async () => {
      fresh.resolve({ configured: true, message: "fresh-updater-message" });
      await fresh.promise;
    });
    expect(
      await screen.findByText("fresh-updater-message")
    ).toBeInTheDocument();
  });
});
