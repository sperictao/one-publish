import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Collapse } from "@/components/ui/collapse";

describe("Collapse", () => {
  it("展开时使用 1fr 行且内容可交互", () => {
    const { container } = render(
      <Collapse open>
        <button type="button">内部按钮</button>
      </Collapse>
    );

    expect(container.firstElementChild).toHaveClass("grid-rows-[1fr]");
    expect(screen.getByRole("button", { name: "内部按钮" })).toBeInTheDocument();
    expect(container.querySelector("[inert]")).toBeNull();
  });

  it("收起时使用 0fr 行且内容保持挂载但惰性", () => {
    const { container } = render(
      <Collapse open={false}>
        <button type="button">内部按钮</button>
      </Collapse>
    );

    expect(container.firstElementChild).toHaveClass("grid-rows-[0fr]");
    expect(container.querySelector("[inert]")).not.toBeNull();
    expect(container.textContent).toContain("内部按钮");
  });
});
