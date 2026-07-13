import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CodeWell } from "@/components/ui/code-well";
import { IconChip } from "@/components/ui/icon-chip";
import { Input } from "@/components/ui/input";
import { SectionLabel } from "@/components/ui/section-label";
import { Select, SelectTrigger, SelectValue } from "@/components/ui/select";

describe("micro primitives", () => {
  it("SectionLabel renders uppercase label token", () => {
    render(<SectionLabel>参数</SectionLabel>);

    const label = screen.getByText("参数");

    expect(label).toHaveClass("uppercase");
    expect(label).toHaveClass("text-label-12");
    expect(label).toHaveClass("text-muted-foreground");
  });

  it("CodeWell renders mono code well surface", () => {
    render(<CodeWell>dotnet publish</CodeWell>);

    const well = screen.getByText("dotnet publish");

    expect(well).toHaveClass("font-mono");
    expect(well).toHaveClass("bg-muted");
    expect(well).toHaveClass("rounded-sm");
  });

  it("IconChip renders interactive-tinted chip", () => {
    render(<IconChip>i</IconChip>);

    const chip = screen.getByText("i");

    expect(chip).toHaveClass("bg-interactive/10");
    expect(chip).toHaveClass("text-interactive");
    expect(chip).toHaveClass("size-8");
  });

  it("Input inputSize=sm renders the compact height", () => {
    render(<Input inputSize="sm" placeholder="搜索" />);

    const input = screen.getByPlaceholderText("搜索");

    expect(input).toHaveClass("h-8");
    expect(input).not.toHaveClass("h-10");
  });

  it("Input defaults to the standard height", () => {
    render(<Input placeholder="默认" />);

    const input = screen.getByPlaceholderText("默认");

    expect(input).toHaveClass("h-10");
  });

  it("SelectTrigger size=sm renders the compact height", () => {
    render(
      <Select>
        <SelectTrigger size="sm" aria-label="配置">
          <SelectValue placeholder="选择" />
        </SelectTrigger>
      </Select>
    );

    const trigger = screen.getByRole("combobox", { name: "配置" });

    expect(trigger).toHaveClass("h-8");
    expect(trigger).not.toHaveClass("h-10");
  });
});
