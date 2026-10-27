import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AppErrorBoundary, ErrorBoundary } from "@/components/ErrorBoundary";

function Throwing(): never {
  throw new Error("渲染失败样例");
}

describe("ErrorBoundary", () => {
  it("无异常时渲染子树", () => {
    render(
      <ErrorBoundary appT={{}}>
        <p>正常内容</p>
      </ErrorBoundary>
    );
    expect(screen.getByText("正常内容")).toBeInTheDocument();
  });

  it("捕获渲染异常后展示本地化兜底与错误摘要", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary
        appT={{
          errorBoundaryTitle: "渲染崩了",
          errorBoundaryDescription: "请重试",
          errorBoundaryDetails: "详情",
          errorBoundaryReload: "重载",
        }}
      >
        <Throwing />
      </ErrorBoundary>
    );
    expect(screen.getByText("渲染崩了")).toBeInTheDocument();
    expect(screen.getByText("请重试")).toBeInTheDocument();
    expect(screen.getByText("渲染失败样例")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重载" })).toBeInTheDocument();
  });

  it("翻译缺失时回落内置中文文案", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary appT={{}}>
        <Throwing />
      </ErrorBoundary>
    );
    expect(screen.getByText("界面渲染遇到问题")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "重新加载" })
    ).toBeInTheDocument();
  });
});

describe("AppErrorBoundary", () => {
  it("包装层渲染子树并连接 i18n", () => {
    render(
      <AppErrorBoundary>
        <p>正常内容</p>
      </AppErrorBoundary>
    );
    expect(screen.getByText("正常内容")).toBeInTheDocument();
  });
});
