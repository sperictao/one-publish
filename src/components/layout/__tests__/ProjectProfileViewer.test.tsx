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
});
