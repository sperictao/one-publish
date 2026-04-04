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
