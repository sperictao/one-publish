import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PublishRunCard } from "@/components/publish/PublishRunCard";

vi.mock("@/lib/store/api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/store/api")>("@/lib/store/api");
  return {
    ...actual,
    openOutputDirectory: vi.fn(),
  };
});

describe("PublishRunCard", () => {
  it("renders the dedicated Tauri release management action", () => {
    const onOpenManagement = vi.fn();
    render(
      <PublishRunCard
        outputLog=""
        publishResult={null}
        appT={{ outputLogTitle: "执行发布", noOutput: "无输出" }}
        publishActions={{
          isPublishing: false,
          isCancellingPublish: false,
          startDisabled: false,
          onStartPublish: vi.fn(),
          onCancelPublish: vi.fn(),
          managementLabel: "Tauri 发布中心",
          onOpenManagement,
        }}
      />
    );

    screen.getByRole("button", { name: "Tauri 发布中心" }).click();

    expect(onOpenManagement).toHaveBeenCalledOnce();
  });

  it("发布状态区只渲染一个状态图标", () => {
    render(
      <PublishRunCard
        outputLog=""
        publishResult={{
          provider_id: "dotnet",
          success: true,
          cancelled: false,
          error: null,
          command: {
            program: "dotnet",
            args: ["publish", "/tmp/output/App.csproj"],
            working_dir: "/tmp/output",
            display_command: 'dotnet publish "/tmp/output/App.csproj"',
            env: [],
          },
          output_log: "",
          output_dir: "/tmp/output",
          file_count: 3,
          warnings: null,
        }}
        appT={{
          outputLogTitle: "执行发布",
          publishStatusLabel: "发布状态",
          statusSuccess: "成功",
          publishStatusSuccessDetail:
            "发布已完成，可直接打开输出目录查看产物。",
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

  it("执行按钮显示文字且保留主操作样式", () => {
    render(
      <PublishRunCard
        outputLog=""
        publishResult={null}
        appT={{
          outputLogTitle: "执行发布",
          publishStatusLabel: "发布状态",
          publishStatusIdle: "待执行",
          publishStatusIdleDetail: "命令与参数已准备完成，可以开始本次发布。",
          noOutput: "无输出",
        }}
        publishActions={{
          publishCommand: 'dotnet publish "/repo/App.csproj"',
          publishCommandLabel: "将执行的命令:",
          startLabel: "执行发布",
          isPublishing: false,
          isCancellingPublish: false,
          startDisabled: false,
          onStartPublish: vi.fn(),
          onCancelPublish: vi.fn(),
        }}
      />
    );

    const publishButton = screen.getByRole("button", { name: "执行发布" });
    const statusPanel = screen.getByTestId("publish-status-panel");

    expect(publishButton).toHaveClass("text-primary-foreground");
    expect(publishButton).toHaveClass("w-full");
    expect(publishButton).toHaveClass("sm:flex-1");
    expect(statusPanel).toHaveClass("block");
    expect(statusPanel).toHaveClass("w-full");
    expect(statusPanel).toHaveClass("rounded-sm");
    expect(statusPanel).toHaveClass("p-4");
    expect(statusPanel).toHaveTextContent("发布状态");
    expect(statusPanel).toHaveTextContent("待执行");
  });

  it("发布中按钮和取消发布按钮使用明确的操作状态样式", () => {
    render(
      <PublishRunCard
        outputLog=""
        publishResult={null}
        appT={{
          outputLogTitle: "执行发布",
          publishStatusLabel: "发布状态",
          publishStatusRunning: "发布中",
          publishStatusRunningDetail:
            "发布命令正在执行，日志会持续追加到下方输出区域。",
          noOutput: "无输出",
        }}
        publishActions={{
          publishingLabel: "发布中...",
          cancelLabel: "取消发布",
          isPublishing: true,
          isCancellingPublish: false,
          startDisabled: false,
          onStartPublish: vi.fn(),
          onCancelPublish: vi.fn(),
        }}
      />
    );

    const publishingButton = screen.getByRole("button", { name: "发布中..." });
    const cancelButton = screen.getByRole("button", { name: "取消发布" });

    expect(publishingButton).toBeDisabled();
    expect(publishingButton).toHaveClass("bg-interactive/10");
    expect(publishingButton).toHaveClass("text-interactive");
    expect(publishingButton).toHaveClass("disabled:opacity-100");
    expect(cancelButton).toHaveClass("h-12");
    expect(cancelButton).toHaveClass("border-destructive/30");
    expect(cancelButton).toHaveClass("bg-destructive/5");
    expect(cancelButton).toHaveClass("text-destructive");
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

    expect(
      screen.getByText('dotnet publish "/repo-a/App.csproj"')
    ).toBeInTheDocument();

    rerender(
      <PublishRunCard
        isRefreshing
        outputLog=""
        publishResult={null}
        appT={appT}
        publishActions={null}
      />
    );

    expect(
      screen.getByText('dotnet publish "/repo-a/App.csproj"')
    ).toBeInTheDocument();
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

    expect(
      screen.getByText('dotnet publish "/repo-b/App.csproj"')
    ).toBeInTheDocument();
  });

  it("成功且带 warnings 时展示警告摘要", () => {
    render(
      <PublishRunCard
        outputLog=""
        publishResult={{
          provider_id: "dotnet",
          success: true,
          cancelled: false,
          error: null,
          command: {
            program: "dotnet",
            args: ["publish", "/tmp/output/App.csproj"],
            working_dir: "/tmp/output",
            display_command: 'dotnet publish "/tmp/output/App.csproj"',
            env: [],
          },
          output_log: "",
          output_dir: "/tmp/output",
          file_count: 3,
          warnings: [
            "warning CS0168: The variable 'x' is declared but never used",
            "warning NU1903: Package 'Foo' has a known vulnerability",
          ],
        }}
        appT={{
          outputLogTitle: "执行发布",
          publishStatusLabel: "发布状态",
          statusSuccess: "成功",
          publishStatusSuccessDetail: "发布已完成",
          publishWarningsLabel: "个警告",
          openOutputDirLabel: "打开输出目录",
          outputDirectoryLabel: "输出目录",
        }}
        publishActions={null}
      />
    );

    expect(screen.getByText("2 个警告")).toBeInTheDocument();
  });

  it("warnings 为 null 时不展示警告摘要", () => {
    render(
      <PublishRunCard
        outputLog=""
        publishResult={{
          provider_id: "dotnet",
          success: true,
          cancelled: false,
          error: null,
          command: {
            program: "dotnet",
            args: ["publish", "/tmp/output/App.csproj"],
            working_dir: "/tmp/output",
            display_command: 'dotnet publish "/tmp/output/App.csproj"',
            env: [],
          },
          output_log: "",
          output_dir: "/tmp/output",
          file_count: 3,
          warnings: null,
        }}
        appT={{
          outputLogTitle: "执行发布",
          publishStatusLabel: "发布状态",
          statusSuccess: "成功",
          publishStatusSuccessDetail: "发布已完成",
          publishWarningsLabel: "个警告",
          openOutputDirLabel: "打开输出目录",
          outputDirectoryLabel: "输出目录",
        }}
        publishActions={null}
      />
    );

    expect(screen.queryByText(/个警告/)).not.toBeInTheDocument();
  });

  it("展示选中配置对应的本地计划摘要与阻塞原因", () => {
    render(
      <PublishRunCard
        outputLog=""
        publishResult={null}
        appT={{ outputLogTitle: "执行发布", noOutput: "无输出" }}
        preparedRuntime={{
          configurationId: "configuration-A",
          configurationRevisionId: "revision-A",
          command: {
            program: "dotnet",
            args: ["publish"],
            working_dir: "/repo",
            display_command: "dotnet publish /repo/App.csproj",
            env: [],
          },
          plan: {
            version: 1,
            digest: "plan-digest-A",
            snapshotDigest: "snapshot-digest-A",
            executionBackend: "local-execution",
            nodes: [
              {
                id: "build",
                stage: "build",
                adapterId: "selected-project-provider",
                operation: "selected-project-provider:publish",
                irreversible: false,
              },
              {
                id: "persist",
                stage: "persist_manifest",
                adapterId: "temporary-artifact-store",
                operation: "persist_manifest",
                irreversible: false,
              },
            ],
          },
          blockedReason: "publish output access is denied",
          runtimeToken: "",
        }}
        publishActions={{
          isPublishing: false,
          isCancellingPublish: false,
          startDisabled: true,
          onStartPublish: vi.fn(),
          onCancelPublish: vi.fn(),
        }}
      />
    );

    const plan = screen.getByTestId("publish-runtime-plan");
    expect(plan).toHaveTextContent("revision-A");
    expect(plan).toHaveTextContent("plan-digest-A");
    expect(plan).toHaveTextContent("local-execution");
    expect(plan).toHaveTextContent("build");
    expect(plan).toHaveTextContent("persist_manifest");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "publish output access is denied"
    );
    expect(screen.getByTestId("publish-execute-btn")).toBeDisabled();
  });

  it("选中 Tauri 配置时右侧用通用计划展示 Provider 阶段与驱动命令", () => {
    render(
      <PublishRunCard
        outputLog=""
        publishResult={null}
        appT={{ outputLogTitle: "执行发布", noOutput: "无输出" }}
        preparedRuntime={{
          configurationId: "configuration-tauri",
          configurationRevisionId: "revision-tauri",
          command: {
            program: "pnpm",
            args: ["tauri", "build"],
            working_dir: "/repo",
            display_command: "pnpm tauri build",
            env: [],
          },
          plan: {
            version: 1,
            digest: "plan-digest-tauri",
            snapshotDigest: "snapshot-digest-tauri",
            executionBackend: "local-execution",
            nodes: [
              {
                id: "project.inspect",
                stage: "inspect_source",
                adapterId: "tauri",
                operation: "inspect_tauri_project",
                irreversible: false,
              },
              {
                id: "project.build",
                stage: "build",
                adapterId: "tauri",
                operation: "tauri-driver:pnpm",
                irreversible: false,
              },
            ],
          },
          blockedReason: null,
          runtimeToken: "runtime-token-tauri",
        }}
        publishActions={{
          publishCommand: "pnpm tauri build",
          publishCommandLabel: "将执行的命令:",
          isPublishing: false,
          isCancellingPublish: false,
          startDisabled: false,
          onStartPublish: vi.fn(),
          onCancelPublish: vi.fn(),
        }}
      />
    );

    const plan = screen.getByTestId("publish-runtime-plan");
    expect(plan).toHaveTextContent("inspect_source");
    expect(plan).toHaveTextContent("build");
    expect(screen.getByText("pnpm tauri build")).toBeInTheDocument();
    expect(screen.getByTestId("publish-execute-btn")).toBeEnabled();
  });

  it("Tauri 检测阻断时展示阻断原因、空计划并禁止执行", () => {
    render(
      <PublishRunCard
        outputLog=""
        publishResult={null}
        appT={{ outputLogTitle: "执行发布", noOutput: "无输出" }}
        preparedRuntime={{
          configurationId: "configuration-tauri",
          configurationRevisionId: "revision-tauri",
          command: {
            program: "",
            args: [],
            working_dir: null,
            display_command: "",
            env: [],
          },
          plan: {
            version: 0,
            digest: "",
            snapshotDigest: "",
            executionBackend: "",
            nodes: [],
          },
          blockedReason:
            "tauri_build_driver_conflict: conflicting Tauri package-manager lockfiles: pnpm, yarn",
          runtimeToken: "",
        }}
        publishActions={{
          isPublishing: false,
          isCancellingPublish: false,
          startDisabled: true,
          onStartPublish: vi.fn(),
          onCancelPublish: vi.fn(),
        }}
      />
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "tauri_build_driver_conflict"
    );
    expect(screen.getByTestId("publish-execute-btn")).toBeDisabled();
  });

  it("展示 Manifest、稳定 Receipt ID 与最终 Delivery Lifecycle", () => {
    render(
      <PublishRunCard
        outputLog="published"
        publishResult={null}
        appT={{ outputLogTitle: "执行发布", noOutput: "无输出" }}
        runtimeResult={{
          attempt: {
            attemptId: "attempt-A",
            backendRunId: "backend-run-A",
            configurationRevisionId: "revision-A",
            planDigest: "plan-digest-A",
            executionBackend: "local-execution",
            status: "published",
            manifestDigest: "manifest-digest-A",
            manifest: { digest: "manifest-digest-A", artifactCount: 2 },
            receipts: [
              {
                version: 1,
                receiptId: "receipt-stable-A",
                revision: 1,
                routeId: "local-delivery",
                manifestDigest: "manifest-digest-A",
                status: "published",
                externalReference: "/repo/publish-output",
              },
            ],
            events: [
              {
                eventId: "event-receipt-A",
                planNodeId: "publish-routes",
                kind: "delivery_receipt_observed",
                manifestDigest: "manifest-digest-A",
                receiptId: "receipt-stable-A",
                deliveryStatus: "published",
                receipt: {
                  version: 1,
                  receiptId: "receipt-stable-A",
                  revision: 1,
                  routeId: "local-delivery",
                  manifestDigest: "manifest-digest-A",
                  status: "published",
                  externalReference: "/repo/publish-output",
                },
                error: null,
              },
            ],
            error: null,
          },
          publishResult: null,
        }}
        publishActions={null}
      />
    );

    const result = screen.getByTestId("publish-runtime-result");
    expect(result).toHaveTextContent("manifest-digest-A");
    expect(result).toHaveTextContent("2");
    expect(result).toHaveTextContent("receipt-stable-A");
    expect(result).toHaveTextContent("published");
  });
});
