import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "@/components/ui/button";

describe("Button", () => {
  it("keeps foreground color on the default primary button", () => {
    render(<Button>执行发布</Button>);

    const button = screen.getByRole("button", { name: "执行发布" });

    expect(button).toHaveClass("bg-primary");
    expect(button).toHaveClass("text-primary-foreground");
    expect(button).toHaveClass("text-button-14");
  });
});
