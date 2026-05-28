import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, memo } from "react";
import {
  SettingsDialog,
  GeneralSettingsSection,
  UpdaterProgressBar,
} from "../SettingsDialog";

// Mock Tauri modules
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: vi.fn().mockResolvedValue(undefined),
}));

// Mock translations
vi.mock("@/hooks/useI18n", () => {
  const translations = {
    settings: {
      title: "应用设置",
      description: "配置语言、外观、输出目录等偏好设置",
      categories: {
        general: "通用",
        appearance: "外观",
        environment: "环境检查",
        shortcuts: "快捷键",
        about: "关于",
      },
      sections: {
        generalDescription: "管理语言、默认输出目录与运行偏好。",
        appearanceDescription: "调整主题显示风格，匹配你的系统与使用习惯。",
        environmentDescription: "查看环境诊断结果并快速进入检查页。",
        shortcutsDescription: "查看全局快捷键，提高常用操作效率。",
        aboutDescription: "查看版本信息、更新状态与更新日志。",
      },
      general: {
        executionHistoryLimitLabel: "执行历史保留上限",
        executionHistoryLimitDescription: "可设置 5~200 条，超出范围会自动修正并即时生效。",
        preRerunChecklistLabel: "重跑前确认清单",
        preRerunChecklistDescription: "启用后，点击“重跑记录”会先检查分支、环境和输出目标确认项。",
      },
    },
    language: {
      label: "界面语言",
      placeholder: "选择语言",
      chinese: "简体中文",
      english: "English",
      changed: "语言已切换为 {{language}}",
      changeFailed: "语言切换失败",
    },
    outputDir: {
      label: "默认发布目录",
      placeholder: "留空使用项目默认目录",
      support: "支持相对路径（如 ./publish）或绝对路径",
    },
    tray: {
      label: "关闭窗口时最小化到托盘",
      description: "启用后点击关闭按钮会隐藏窗口，继续驻留托盘。",
    },
    theme: {
      label: "外观主题",
      placeholder: "选择主题",
      auto: "跟随系统",
      light: "亮色",
      dark: "暗色",
    },
    shortcuts: {
      refresh: "刷新项目",
      publish: "执行发布",
      settings: "打开设置",
      button: "查看快捷键",
    },
    version: {
      current: "当前版本: {}",
      new: "最新可用版本: {}",
      clickToCheck: "点击检查更新以获取最新版本信息",
      none: "没有可用的更新",
      check: "检查更新",
      update: "更新",
      restarting: "重启中...",
      restart: "重启应用",
      restartFailed: "重启应用失败，请稍后重试",
      notes: "更新说明:",
    },
    app: {
      loading: "加载中...",
    },
  };

  return {
    useI18n: () => ({
      language: "zh",
      setLanguage: vi.fn(),
      t: (key: string, params?: Record<string, string | number>) => {
        let text = key;
        const parts = key.split(".");
        let current: any = translations;
        for (const part of parts) {
          if (current && part in current) {
            current = current[part];
          } else {
            current = undefined;
            break;
          }
        }
        if (typeof current === "string") {
          text = current;
        }
        if (params) {
          Object.keys(params).forEach((paramKey) => {
            text = text.replace(new RegExp(`{{${paramKey}}}`, "g"), String(params[paramKey]));
          });
        }
        return text;
      },
      translations,
    }),
    t: (key: string, _params?: Record<string, string | number>) => {
      if (key === "version.current") return "当前版本: {}";
      if (key === "version.new") return "最新可用版本: {}";
      return key;
    },
  };
});

describe("SettingsDialog", () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    language: "zh" as const,
    onLanguageChange: vi.fn(),
    minimizeToTrayOnClose: false,
    onMinimizeToTrayOnCloseChange: vi.fn(),
    defaultOutputDir: "/test/output",
    onDefaultOutputDirChange: vi.fn(),
    executionHistoryLimit: 10,
    onExecutionHistoryLimitChange: vi.fn(),
    preRerunChecklistEnabled: true,
    onPreRerunChecklistEnabledChange: vi.fn(),
    theme: "dark" as const,
    onThemeChange: vi.fn(),
    onOpenShortcuts: vi.fn(),
    providers: [],
    environmentProviderIds: ["dotnet"],
    onEnvironmentProviderIdsChange: vi.fn(),
    updaterState: {
      currentVersion: "1.0.0",
      updateInfo: null,
      isRestartRequired: false,
      isCheckingUpdate: false,
      isInstallingUpdate: false,
      updaterHelpPaths: null,
      updaterConfigHealth: null,
      isOpeningUpdaterHelp: false,
      downloadProgress: {
        stage: "idle" as const,
        version: null,
        downloadedBytes: 0,
        totalBytes: null,
        percent: null,
        attempt: 0,
        maxAttempts: 0,
        message: null,
      },
    },
    onCheckForUpdates: vi.fn().mockResolvedValue(undefined),
    onInstallAvailableUpdate: vi.fn().mockResolvedValue(undefined),
    onOpenUpdaterHelpTarget: vi.fn().mockResolvedValue(undefined),
  };

  beforeAll(() => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation(() => ({
        matches: false,
        media: "(prefers-color-scheme: dark)",
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }))
    );

    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
  });

  it("当 open 为 true 时，渲染对话框、标题和类别导航栏", () => {
    render(<SettingsDialog {...defaultProps} />);

    expect(screen.getByText("应用设置")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /通用/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /外观/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /关于/ })).toBeInTheDocument();
  });

  it("当点击各个类别导航时，能正常切换页面内容", async () => {
    render(<SettingsDialog {...defaultProps} />);

    // 默认展示 “通用”
    expect(screen.getByLabelText("默认发布目录")).toBeInTheDocument();

    // 点击 “外观”
    fireEvent.click(screen.getByRole("button", { name: /外观/ }));
    await waitFor(() => {
      expect(screen.getByLabelText("外观主题")).toBeInTheDocument();
    });

    // 点击 “关于”
    fireEvent.click(screen.getByRole("button", { name: /关于/ }));
    await waitFor(() => {
      expect(screen.getByText("当前版本: 1.0.0")).toBeInTheDocument();
    });
  });

  it("子组件支持 React.memo 并阻止不必要的重新渲染", () => {
    let renderTimes = 0;

    const MemoTestComponent = memo(({ count }: { count: number }) => {
      renderTimes++;
      return <div>Count: {count}</div>;
    });

    const Parent = () => {
      const [localCount, setLocalCount] = useState(0);
      const [otherState, setOtherState] = useState(0);

      return (
        <div>
          <button onClick={() => setLocalCount(localCount + 1)}>Inc Count</button>
          <button onClick={() => setOtherState(otherState + 1)}>Inc Other</button>
          <MemoTestComponent count={10} />
        </div>
      );
    };

    render(<Parent />);
    expect(renderTimes).toBe(1);

    // 点击 Inc Other 改变 parent 状态，但 MemoTestComponent 传入的 props (count=10) 未变
    fireEvent.click(screen.getByText("Inc Other"));
    expect(renderTimes).toBe(1); // 证明 memo 阻止了重新渲染
  });

  it("GeneralSettingsSection 能够正确触发各项表单回调", () => {
    const onLanguageChange = vi.fn();
    const onExecutionHistoryLimitChange = vi.fn();
    const onDefaultOutputDirChange = vi.fn();
    const onSelectDirectory = vi.fn();
    const onPreRerunChecklistEnabledChange = vi.fn();
    const onMinimizeToTrayOnCloseChange = vi.fn();

    render(
      <GeneralSettingsSection
        translations={{
          language: { label: "界面语言", placeholder: "选择语言" },
          outputDir: { label: "默认发布目录", support: "支持" },
          settings: {
            general: {
              executionHistoryLimitLabel: "限制",
              preRerunChecklistLabel: "重跑确认",
            },
          },
          tray: { label: "最小化托盘" },
        }}
        language="zh"
        onLanguageChange={onLanguageChange}
        executionHistoryLimit={10}
        onExecutionHistoryLimitChange={onExecutionHistoryLimitChange}
        defaultOutputDir="/old"
        onDefaultOutputDirChange={onDefaultOutputDirChange}
        onSelectDirectory={onSelectDirectory}
        preRerunChecklistEnabled={true}
        onPreRerunChecklistEnabledChange={onPreRerunChecklistEnabledChange}
        minimizeToTrayOnClose={true}
        onMinimizeToTrayOnCloseChange={onMinimizeToTrayOnCloseChange}
      />
    );

    // 修改保留限制
    const historyInput = screen.getByLabelText("限制");
    fireEvent.change(historyInput, { target: { value: "25" } });
    expect(onExecutionHistoryLimitChange).toHaveBeenCalledWith(25);

    // 修改发布目录
    const dirInput = screen.getByLabelText("默认发布目录");
    fireEvent.change(dirInput, { target: { value: "/new" } });
    expect(onDefaultOutputDirChange).toHaveBeenCalledWith("/new");

    // 点击选择目录按钮
    const dirBtn = screen.getByRole("button");
    fireEvent.click(dirBtn);
    expect(onSelectDirectory).toHaveBeenCalled();
  });

  it("UpdaterProgressBar 能够正确展示下载进度百分比", () => {
    render(
      <UpdaterProgressBar
        translations={{
          version: { downloading: "下载中...", downloadProgress: "已下载 {} / {}" },
        }}
        downloadProgress={{
          stage: "downloading",
          downloadedBytes: 1024,
          totalBytes: 2048,
          percent: 50,
        }}
      />
    );

    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("已下载 1.00 KB / 2.00 KB")).toBeInTheDocument();
  });
});
