import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PublishLogView } from "@/components/publish/PublishLogView";

const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn() },
}));

describe("PublishLogView", () => {
  beforeEach(() => {
    toastSuccess.mockClear();
  });

  it("逐行渲染并对诊断行着色", () => {
    const text = [
      "Restoring packages...",
      "Program.cs(1,1): error CS1002: ; expected",
      "proj.csproj : warning MSB3277: conflict",
    ].join("\n");
    const { container } = render(
      <PublishLogView text={text} getSnapshot={() => text} active={false} />
    );

    const spans = container.querySelectorAll("pre > span");
    expect(spans).toHaveLength(3);
    expect(spans[0].className).not.toContain("text-red");
    expect(spans[1].className).toContain("text-red-500");
    expect(spans[2].className).toContain("text-amber-400");
  });

  it("复制按钮取用完整快照而非可见文本", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(
      <PublishLogView
        text="可见截断片段"
        getSnapshot={() => "完整日志全文"}
        active={false}
        copyLabel="复制日志"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "复制日志" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("完整日志全文"));
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("默认跟随态不显示回到底部按钮", () => {
    render(
      <PublishLogView text="line" getSnapshot={() => "line"} active jumpLabel="回到底部" />
    );
    expect(screen.queryByRole("button", { name: "回到底部" })).toBeNull();
  });
});
