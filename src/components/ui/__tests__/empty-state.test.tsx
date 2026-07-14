import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FolderGit2 } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";

describe("EmptyState", () => {
  it("渲染标题，无 hint 时不渲染提示段", () => {
    const { container } = render(
      <EmptyState icon={FolderGit2} title="暂无仓库" />
    );
    expect(screen.getByText("暂无仓库")).toBeInTheDocument();
    // 仅一个 <p>（标题），无 hint 段
    expect(container.querySelectorAll("p")).toHaveLength(1);
  });

  it("提供 hint 与 action 时一并渲染", () => {
    render(
      <EmptyState
        icon={FolderGit2}
        title="暂无仓库"
        hint="点击下方添加仓库"
        action={<button type="button">添加</button>}
      />
    );
    expect(screen.getByText("点击下方添加仓库")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加" })).toBeInTheDocument();
  });
});
