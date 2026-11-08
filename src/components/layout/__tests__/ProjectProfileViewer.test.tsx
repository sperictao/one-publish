import { createRef } from "react";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/en.json";
import zh from "@/i18n/zh.json";
import {
  ProjectProfileViewer,
  type ProjectProfileViewerHandle,
} from "@/components/layout/publishConfigPanel/ProjectProfileViewer";

const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
  resolveDotnetProjectProfile: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
  },
}));

vi.mock("@/lib/dotnetProjectProfile", () => ({
  resolveDotnetProjectProfile: mocks.resolveDotnetProjectProfile,
}));

describe("ProjectProfileViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["en", en],
    ["zh", zh],
  ])(
    "项目文件路径不可用时按 %s 界面语言提示且不读取配置",
    async (_language, locale) => {
      const ref = createRef<ProjectProfileViewerHandle>();
      render(
        <ProjectProfileViewer
          ref={ref}
          configPanelT={locale.configPanel}
          commonT={locale.common}
        />
      );

      await act(async () => {
        ref.current?.viewProfile("FolderProfile");
      });

      expect(mocks.toastError).toHaveBeenCalledWith(
        locale.configPanel.loadConfigFailed,
        { description: locale.configPanel.loadConfigFailedDescription }
      );
      expect(
        screen.getByText(locale.configPanel.loadConfigFailedDescription)
      ).toBeInTheDocument();
      expect(mocks.resolveDotnetProjectProfile).not.toHaveBeenCalled();
    }
  );

  it("卸载后迟到的解析失败不再弹 toast 或写入 viewer 状态", async () => {
    let rejectResolve!: (reason: unknown) => void;
    mocks.resolveDotnetProjectProfile.mockReturnValue(
      new Promise((_, reject) => {
        rejectResolve = reject;
      })
    );
    const ref = createRef<ProjectProfileViewerHandle>();
    const { unmount } = render(
      <ProjectProfileViewer
        ref={ref}
        projectFilePath="/repo/App.csproj"
        configPanelT={zh.configPanel}
        commonT={zh.common}
      />
    );

    await act(async () => {
      ref.current?.viewProfile("FolderProfile");
    });
    expect(mocks.resolveDotnetProjectProfile).toHaveBeenCalled();

    unmount();
    await act(async () => {
      rejectResolve({ kind: "io", message: "read failed" });
    });

    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("项目文件变化后在途响应不再落回 viewer", async () => {
    let rejectResolve!: (reason: unknown) => void;
    mocks.resolveDotnetProjectProfile.mockReturnValue(
      new Promise((_, reject) => {
        rejectResolve = reject;
      })
    );
    const ref = createRef<ProjectProfileViewerHandle>();
    const { rerender } = render(
      <ProjectProfileViewer
        ref={ref}
        projectFilePath="/repo/App.csproj"
        configPanelT={zh.configPanel}
        commonT={zh.common}
      />
    );

    await act(async () => {
      ref.current?.viewProfile("FolderProfile");
    });

    rerender(
      <ProjectProfileViewer
        ref={ref}
        projectFilePath="/repo/Other.csproj"
        configPanelT={zh.configPanel}
        commonT={zh.common}
      />
    );
    await act(async () => {
      rejectResolve({ kind: "io", message: "read failed" });
    });

    expect(mocks.toastError).not.toHaveBeenCalled();
  });
});
