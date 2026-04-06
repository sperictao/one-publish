import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PublishRunCard } from "@/components/publish/PublishRunCard";

vi.mock("@/lib/store", async () => {
  const actual = await vi.importActual<typeof import("@/lib/store")>("@/lib/store");
  return {
    ...actual,
    openOutputDirectory: vi.fn(),
  };
});

describe("PublishRunCard", () => {
  it("发布状态区只渲染一个状态图标", () => {
    render(
      <PublishRunCard
        outputLog=""
        publishResult={{
          provider_id: "dotnet",
          success: true,
          cancelled: false,
          error: null,
          output_dir: "/tmp/output",
          file_count: 3,
        }}
        appT={{
          outputLogTitle: "执行发布",
          publishStatusLabel: "发布状态",
          statusSuccess: "成功",
          publishStatusSuccessDetail: "发布已完成，可直接打开输出目录查看产物。",
          outputDirectoryLabel: "输出目录",
          fileCountUnit: "个文件",
          noOutput: "无输出",
        }}
        publishActions={null}
      />
    );

    const panel = screen.getByTestId("publish-status-panel");

    expect(panel.querySelectorAll("svg")).toHaveLength(1);
    expect(screen.getByText("成功")).toBeInTheDocument();
  });

  it("长单行日志会被限制在卡片内部换行", () => {
    const longLogLine = `${"C:/very-long-output-path".repeat(24)}/publish-output`;

    render(
      <PublishRunCard
        outputLog={longLogLine}
        publishResult={null}
        appT={{
          outputLogTitle: "执行发布",
          noOutput: "无输出",
        }}
        publishActions={null}
      />
    );

    const card = screen.getByText("执行发布").closest("[aria-busy]");
    const logPre = screen.getByText(longLogLine).closest("pre");

    expect(card).not.toBeNull();
    expect(card).toHaveClass("min-w-0");
    expect(card).toHaveClass("max-w-full");
    expect(logPre).not.toBeNull();
    expect(logPre).toHaveClass("break-all");
    expect(logPre?.className).toContain("[overflow-wrap:anywhere]");
  });

  it("刷新期间保留上一帧执行信息并显示遮罩", () => {
    const appT = {
      outputLogTitle: "执行发布",
      publishStatusLabel: "发布状态",
      publishStatusIdle: "待执行",
      publishStatusIdleDetail: "命令与参数已准备完成，可以开始本次发布。",
      refreshingPublishCard: "正在刷新发布信息...",
      noOutput: "无输出",
      cancelPublish: "取消发布",
      cancelling: "取消中...",
    };
    const { rerender } = render(
      <PublishRunCard
        outputLog="old log"
        publishResult={null}
        appT={appT}
        publishActions={{
          publishCommand: 'dotnet publish "/repo-a/App.csproj"',
          isPublishing: false,
          isCancellingPublish: false,
          startDisabled: false,
          onStartPublish: vi.fn(),
          onCancelPublish: vi.fn(),
        }}
      />
    );

    expect(screen.getByText('dotnet publish "/repo-a/App.csproj"')).toBeInTheDocument();

    rerender(
      <PublishRunCard
        isRefreshing
        outputLog=""
        publishResult={null}
        appT={appT}
        publishActions={null}
      />
    );

    expect(screen.getByText('dotnet publish "/repo-a/App.csproj"')).toBeInTheDocument();
    expect(screen.getByText("正在刷新发布信息...")).toBeInTheDocument();
    expect(screen.getByText("old log")).toBeInTheDocument();

    rerender(
      <PublishRunCard
        outputLog=""
        publishResult={null}
        appT={appT}
        publishActions={{
          publishCommand: 'dotnet publish "/repo-b/App.csproj"',
          isPublishing: false,
          isCancellingPublish: false,
          startDisabled: false,
          onStartPublish: vi.fn(),
          onCancelPublish: vi.fn(),
        }}
      />
    );

    expect(screen.getByText('dotnet publish "/repo-b/App.csproj"')).toBeInTheDocument();
  });
});
