import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PublishConfigPanel } from "@/components/layout/PublishConfigPanel";
import { __setTranslationsCacheForTest } from "@/hooks/useI18n";
import type { ConfigProfile, PublishConfigStore } from "@/lib/store";
import type { ParameterSchema } from "@/types/parameters";

const ROW_HEIGHT = 40;
const ROW_GAP = 8;
const ROW_STRIDE = ROW_HEIGHT + ROW_GAP;

function createDomRect(top: number, height = ROW_HEIGHT): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    left: 0,
    width: 320,
    height,
    right: 320,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

function getRenderedConfigIds(container: HTMLElement, prefix: string): string[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>("[data-list-row='true'][data-list-item-id]")
  )
    .map((row) => row.dataset.listItemId ?? "")
    .filter((itemId) => itemId.startsWith(prefix));
}

function getFloatingCardMotionElement(container: HTMLElement): HTMLElement | null {
  const selectedSurface = container.querySelector<HTMLElement>(
    ".floating-list-card[data-selected='true']"
  );
  return selectedSurface?.parentElement?.parentElement ?? null;
}

let getBoundingClientRectSpy: ReturnType<typeof vi.spyOn> | null = null;

const { resolveDotnetProjectProfileMock } = vi.hoisted(() => ({
  resolveDotnetProjectProfileMock: vi.fn(),
}));

vi.mock("@/lib/dotnetProjectProfile", () => ({
  resolveDotnetProjectProfile: resolveDotnetProjectProfileMock,
}));

function createProfile(name: string, profileGroup?: string): ConfigProfile {
  return {
    name,
    providerId: "dotnet",
    parameters: {},
    profileGroup,
    createdAt: new Date().toISOString(),
    isSystemDefault: false,
  };
}

const dotnetSchema: ParameterSchema = {
  parameters: {
    configuration: {
      type: "string",
      flag: "--configuration",
    },
    runtime: {
      type: "string",
      flag: "--runtime",
    },
    output: {
      type: "string",
      flag: "--output",
    },
    self_contained: {
      type: "boolean",
      flag: "--self-contained",
    },
    framework: {
      type: "string",
      flag: "--framework",
      description: "Target framework",
    },
    no_build: {
      type: "boolean",
      flag: "--no-build",
      description: "Skip build",
    },
    properties: {
      type: "map",
      flag: "",
      prefix: "-p:",
      description: "MSBuild properties",
    },
    define: {
      type: "array",
      flag: "--define",
      description: "Conditional compilation symbols",
    },
  },
};

beforeAll(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation(() => ({
      matches: false,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  );

  if (typeof PointerEvent === "undefined") {
    vi.stubGlobal("PointerEvent", MouseEvent);
  }

  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );

  if (!HTMLElement.prototype.getAnimations) {
    Object.defineProperty(HTMLElement.prototype, "getAnimations", {
      configurable: true,
      writable: true,
      value: () => [],
    });
  }

  if (!HTMLElement.prototype.animate) {
    Object.defineProperty(HTMLElement.prototype, "animate", {
      configurable: true,
      writable: true,
      value: () => ({
        cancel() {},
      }),
    });
  }

  getBoundingClientRectSpy = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function mockRect(this: HTMLElement) {
      const rowElement =
        this.matches("[data-list-row='true']")
          ? this
          : this.closest<HTMLElement>("[data-list-row='true']");

      if (rowElement) {
        const rows = Array.from(
          document.querySelectorAll<HTMLElement>("[data-list-row='true']")
        );
        const rowIndex = rows.indexOf(rowElement);
        return createDomRect(Math.max(0, rowIndex) * ROW_STRIDE);
      }

      if (this.classList.contains("list-scroll-shell")) {
        return createDomRect(0, 600);
      }

      return createDomRect(0);
    });

  __setTranslationsCacheForTest({
    zh: {
      repositoryList: {
        all: "全部",
        moreActions: "更多操作",
      },
      configPanel: {
        allConfigs: "全部",
        profileGroup: "项目发布配置",
        moreActions: "更多操作",
        recentlyUsed: "最近使用",
        showReorderControls: "开启排序",
        hideReorderControls: "关闭排序",
        favoriteConfig: "收藏配置",
        unfavoriteConfig: "取消收藏",
        dragToReorder: "拖动排序",
        dragDisabledWhileSearching: "搜索时无法排序",
        removeRecent: "从最近使用移除",
        deleteConfig: "删除配置",
        editConfig: "编辑配置",
        searchConfig: "搜索配置",
        refreshingProjectProfiles: "正在刷新项目发布配置...",
        refreshingCustomProfiles: "正在刷新自定义配置...",
      },
    },
  });
});

afterAll(() => {
  getBoundingClientRectSpy?.mockRestore();
});

beforeEach(() => {
  localStorage.setItem("app-language", "zh");
  resolveDotnetProjectProfileMock.mockReset();
});

describe("PublishConfigPanel", () => {
  it("项目发布配置刷新期间不会阻塞自定义配置组渲染", async () => {
    render(
      <PublishConfigPanel
        selectedPreset="release-fd"
        isCustomMode={true}
        profiles={[createProfile("alpha-profile")]}
        isProfilesRefreshing={false}
        activeProfileName="alpha-profile"
        onSelectProfile={() => {}}
        onCreateProfile={() => {}}
        onEditProfile={() => {}}
        onRefreshProfiles={() => {}}
        onOpenConfigDialog={() => {}}
        onDeleteProfile={() => {}}
        dotnetSchema={dotnetSchema}
        projectPublishProfiles={[]}
        isProjectProfilesRefreshing
        onSelectProjectProfile={() => {}}
        onCopyProjectProfileToCustom={async (_name, _config: PublishConfigStore) => "copied"}
        recentConfigKeys={[]}
        favoriteConfigKeys={[]}
        onToggleFavoriteConfig={() => {}}
        onRemoveRecentConfig={() => {}}
        onReorderRecentConfigs={() => {}}
        onReorderProjectProfiles={() => {}}
        onReorderProfiles={() => {}}
      />
    );

    expect(screen.getByText("alpha-profile")).toBeInTheDocument();
    expect(screen.getByText("正在刷新项目发布配置...")).toBeInTheDocument();
  });

  it("自定义配置刷新期间不会阻塞项目发布配置组渲染", async () => {
    render(
      <PublishConfigPanel
        selectedPreset="profile-FolderProfile"
        isCustomMode={false}
        profiles={[]}
        isProfilesRefreshing
        activeProfileName={null}
        onSelectProfile={() => {}}
        onCreateProfile={() => {}}
        onEditProfile={() => {}}
        onRefreshProfiles={() => {}}
        onOpenConfigDialog={() => {}}
        onDeleteProfile={() => {}}
        dotnetSchema={dotnetSchema}
        projectPublishProfiles={["FolderProfile"]}
        isProjectProfilesRefreshing={false}
        onSelectProjectProfile={() => {}}
        onCopyProjectProfileToCustom={async (_name, _config: PublishConfigStore) => "copied"}
        recentConfigKeys={[]}
        favoriteConfigKeys={[]}
        onToggleFavoriteConfig={() => {}}
        onRemoveRecentConfig={() => {}}
        onReorderRecentConfigs={() => {}}
        onReorderProjectProfiles={() => {}}
        onReorderProfiles={() => {}}
      />
    );

    expect(screen.getAllByText("FolderProfile").length).toBeGreaterThan(0);
    expect(screen.getByText("正在刷新自定义配置...")).toBeInTheDocument();
  });

  it("打开未选中配置菜单时不会误选中，并在离开列表后仍锁定菜单上下文", async () => {
    const onSelectProfile = vi.fn();
    const onSelectProjectProfile = vi.fn();
    const onRemoveRecentConfig = vi.fn();
    const profiles = [createProfile("alpha-profile"), createProfile("beta-profile")];

    const { container } = render(
      <PublishConfigPanel
        selectedPreset="release-fd"
        isCustomMode={true}
        profiles={profiles}
        activeProfileName="alpha-profile"
        onSelectProfile={onSelectProfile}
        onCreateProfile={() => {}}
        onEditProfile={() => {}}
        onRefreshProfiles={() => {}}
        onOpenConfigDialog={() => {}}
        onDeleteProfile={() => {}}
        dotnetSchema={dotnetSchema}
        projectPublishProfiles={[]}
        onSelectProjectProfile={onSelectProjectProfile}
        onCopyProjectProfileToCustom={async (_name, _config: PublishConfigStore) => "copied"}
        recentConfigKeys={["userprofile:beta-profile"]}
        favoriteConfigKeys={[]}
        onToggleFavoriteConfig={() => {}}
        onRemoveRecentConfig={onRemoveRecentConfig}
        onReorderRecentConfigs={() => {}}
        onReorderProjectProfiles={() => {}}
        onReorderProfiles={() => {}}
      />
    );

    const getRecentRow = () =>
      container.querySelector<HTMLElement>(
        '[data-list-item-id="recent:userprofile:beta-profile"]'
      );
    const getList = () =>
      container.querySelector<HTMLElement>(".list-scroll-shell");

    expect(getRecentRow()).not.toBeNull();
    expect(getList()).not.toBeNull();

    fireEvent.pointerEnter(getList()!);
    fireEvent.mouseOver(getRecentRow()!);

    await waitFor(() => {
      expect(getRecentRow()).toHaveAttribute("data-list-visual-target", "true");
    });

    const trigger = within(getRecentRow()!).getByRole("button", {
      name: "更多操作: beta-profile",
    });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);

    await waitFor(() => {
      expect(getRecentRow()).toHaveAttribute("data-list-menu-open", "true");
    });

    const removeRecentItem = await screen.findByRole("menuitem", {
      name: "从最近使用移除",
    });

    expect(onSelectProfile).not.toHaveBeenCalled();
    expect(onSelectProjectProfile).not.toHaveBeenCalled();

    fireEvent.pointerLeave(getList()!);

    expect(getRecentRow()).toHaveAttribute("data-list-menu-open", "true");
    expect(getRecentRow()).toHaveAttribute("data-list-visual-target", "true");

    fireEvent.click(removeRecentItem);

    await waitFor(() => {
      expect(onRemoveRecentConfig).toHaveBeenCalledWith("userprofile:beta-profile");
    });
    expect(onSelectProfile).not.toHaveBeenCalled();
    expect(onSelectProjectProfile).not.toHaveBeenCalled();
  });

  it("切换仓库时会重置 recent 视觉锚点，避免沿用上一仓库的高亮位置", async () => {
    const { container, rerender } = render(
      <PublishConfigPanel
        selectedRepoId="repo-a"
        selectedPreset="profile-FolderProfile"
        isCustomMode={false}
        profiles={[]}
        activeProfileName={null}
        onSelectProfile={() => {}}
        onCreateProfile={() => {}}
        onEditProfile={() => {}}
        onRefreshProfiles={() => {}}
        onOpenConfigDialog={() => {}}
        onDeleteProfile={() => {}}
        dotnetSchema={dotnetSchema}
        projectPublishProfiles={["FolderProfile", "ZipProfile"]}
        onSelectProjectProfile={() => {}}
        onCopyProjectProfileToCustom={async (_name, _config: PublishConfigStore) => "copied"}
        recentConfigKeys={["pubxml:FolderProfile"]}
        favoriteConfigKeys={[]}
        onToggleFavoriteConfig={() => {}}
        onRemoveRecentConfig={() => {}}
        onReorderRecentConfigs={() => {}}
        onReorderProjectProfiles={() => {}}
        onReorderProfiles={() => {}}
      />
    );

    const getRecentRow = () =>
      container.querySelector<HTMLElement>(
        '[data-list-item-id="recent:pubxml:FolderProfile"]'
      );
    const getProjectRow = () =>
      container.querySelector<HTMLElement>(
        '[data-list-item-id="pubxml:FolderProfile"]'
      );

    expect(getProjectRow()).toHaveAttribute("data-list-visual-target", "true");
    expect(getRecentRow()).toHaveAttribute("data-list-visual-target", "false");

    fireEvent.click(
      getRecentRow()!.querySelector<HTMLButtonElement>("button[aria-pressed]")!
    );

    await waitFor(() => {
      expect(getRecentRow()).toHaveAttribute("data-list-visual-target", "true");
    });
    expect(getProjectRow()).toHaveAttribute("data-list-visual-target", "false");
    await waitFor(() => {
      expect(getFloatingCardMotionElement(container)?.style.transform).toContain(
        "translate3d(0px, 0px, 0)"
      );
    });

    rerender(
      <PublishConfigPanel
        selectedRepoId="repo-b"
        selectedPreset="profile-FolderProfile"
        isCustomMode={false}
        profiles={[]}
        activeProfileName={null}
        onSelectProfile={() => {}}
        onCreateProfile={() => {}}
        onEditProfile={() => {}}
        onRefreshProfiles={() => {}}
        onOpenConfigDialog={() => {}}
        onDeleteProfile={() => {}}
        dotnetSchema={dotnetSchema}
        projectPublishProfiles={["FolderProfile", "ZipProfile"]}
        onSelectProjectProfile={() => {}}
        onCopyProjectProfileToCustom={async (_name, _config: PublishConfigStore) => "copied"}
        recentConfigKeys={["pubxml:FolderProfile"]}
        favoriteConfigKeys={[]}
        onToggleFavoriteConfig={() => {}}
        onRemoveRecentConfig={() => {}}
        onReorderRecentConfigs={() => {}}
        onReorderProjectProfiles={() => {}}
        onReorderProfiles={() => {}}
      />
    );

    await waitFor(() => {
      expect(getProjectRow()).toHaveAttribute("data-list-visual-target", "true");
    });
    expect(getRecentRow()).toHaveAttribute("data-list-visual-target", "false");
    await waitFor(() => {
      expect(getFloatingCardMotionElement(container)?.style.transform).toContain(
        `translate3d(0px, ${ROW_STRIDE}px, 0)`
      );
    });
  });

  it("切换仓库时不会复用上一仓库的行重排动画，避免浮卡测量到过渡中的位置", async () => {
    const animateSpy = vi.spyOn(HTMLElement.prototype, "animate");

    try {
      const { rerender } = render(
        <PublishConfigPanel
          selectedRepoId="repo-a"
          selectedPreset="release-fd"
          isCustomMode={true}
          profiles={[createProfile("alpha-profile"), createProfile("beta-profile")]}
          activeProfileName="alpha-profile"
          onSelectProfile={() => {}}
          onCreateProfile={() => {}}
          onEditProfile={() => {}}
          onRefreshProfiles={() => {}}
          onOpenConfigDialog={() => {}}
          onDeleteProfile={() => {}}
          dotnetSchema={dotnetSchema}
          projectPublishProfiles={[]}
          onSelectProjectProfile={() => {}}
          onCopyProjectProfileToCustom={async (_name, _config: PublishConfigStore) => "copied"}
          recentConfigKeys={[]}
          favoriteConfigKeys={[]}
          onToggleFavoriteConfig={() => {}}
          onRemoveRecentConfig={() => {}}
          onReorderRecentConfigs={() => {}}
          onReorderProjectProfiles={() => {}}
          onReorderProfiles={() => {}}
        />
      );

      await waitFor(() => {
        expect(screen.getByText("alpha-profile")).toBeInTheDocument();
      });

      animateSpy.mockClear();

      rerender(
        <PublishConfigPanel
          selectedRepoId="repo-b"
          selectedPreset="release-fd"
          isCustomMode={true}
          profiles={[createProfile("beta-profile"), createProfile("alpha-profile")]}
          activeProfileName="alpha-profile"
          onSelectProfile={() => {}}
          onCreateProfile={() => {}}
          onEditProfile={() => {}}
          onRefreshProfiles={() => {}}
          onOpenConfigDialog={() => {}}
          onDeleteProfile={() => {}}
          dotnetSchema={dotnetSchema}
          projectPublishProfiles={[]}
          onSelectProjectProfile={() => {}}
          onCopyProjectProfileToCustom={async (_name, _config: PublishConfigStore) => "copied"}
          recentConfigKeys={[]}
          favoriteConfigKeys={[]}
          onToggleFavoriteConfig={() => {}}
          onRemoveRecentConfig={() => {}}
          onReorderRecentConfigs={() => {}}
          onReorderProjectProfiles={() => {}}
          onReorderProfiles={() => {}}
        />
      );

      await waitFor(() => {
        const hasCarryoverRowMotion = animateSpy.mock.calls.some(
          ([keyframes, options]) => {
            if (!Array.isArray(keyframes) || keyframes.length !== 2) {
              return false;
            }

            const [firstFrame, lastFrame] = keyframes;
            const firstTransform =
              typeof firstFrame === "object" &&
              firstFrame !== null &&
              "transform" in firstFrame &&
              typeof firstFrame.transform === "string"
                ? firstFrame.transform
                : null;
            const lastTransform =
              typeof lastFrame === "object" &&
              lastFrame !== null &&
              "transform" in lastFrame &&
              typeof lastFrame.transform === "string"
                ? lastFrame.transform
                : null;

            return (
              firstTransform?.startsWith("translate3d(0, ") === true &&
              lastTransform === "translate3d(0, 0, 0)" &&
              typeof options === "object" &&
              options !== null &&
              "fill" in options &&
              options.fill === "both"
            );
          }
        );

        expect(hasCarryoverRowMotion).toBe(false);
      });
    } finally {
      animateSpy.mockRestore();
    }
  });

  it("刷新期间项目配置列表在选中项上方增量补全时，浮卡会立即对齐新位置", async () => {
    const { container, rerender } = render(
      <PublishConfigPanel
        selectedRepoId="repo-b"
        selectedPreset="profile-C PRD"
        isCustomMode={false}
        profiles={[]}
        activeProfileName={null}
        onSelectProfile={() => {}}
        onCreateProfile={() => {}}
        onEditProfile={() => {}}
        onRefreshProfiles={() => {}}
        onOpenConfigDialog={() => {}}
        onDeleteProfile={() => {}}
        dotnetSchema={dotnetSchema}
        projectPublishProfiles={["C PRD"]}
        isProjectProfilesRefreshing
        onSelectProjectProfile={() => {}}
        onCopyProjectProfileToCustom={async (_name, _config: PublishConfigStore) => "copied"}
        recentConfigKeys={[]}
        favoriteConfigKeys={[]}
        onToggleFavoriteConfig={() => {}}
        onRemoveRecentConfig={() => {}}
        onReorderRecentConfigs={() => {}}
        onReorderProjectProfiles={() => {}}
        onReorderProfiles={() => {}}
      />
    );

    await waitFor(() => {
      expect(getFloatingCardMotionElement(container)?.style.transform).toContain(
        "translate3d(0px, 0px, 0)"
      );
    });

    rerender(
      <PublishConfigPanel
        selectedRepoId="repo-b"
        selectedPreset="profile-C PRD"
        isCustomMode={false}
        profiles={[]}
        activeProfileName={null}
        onSelectProfile={() => {}}
        onCreateProfile={() => {}}
        onEditProfile={() => {}}
        onRefreshProfiles={() => {}}
        onOpenConfigDialog={() => {}}
        onDeleteProfile={() => {}}
        dotnetSchema={dotnetSchema}
        projectPublishProfiles={[
          "C DEV",
          "97 Basic",
          "ET_Local_PRD",
          "C PRD",
          "ET_Local_QAS",
          "SSO_DEV",
        ]}
        isProjectProfilesRefreshing
        onSelectProjectProfile={() => {}}
        onCopyProjectProfileToCustom={async (_name, _config: PublishConfigStore) => "copied"}
        recentConfigKeys={[]}
        favoriteConfigKeys={[]}
        onToggleFavoriteConfig={() => {}}
        onRemoveRecentConfig={() => {}}
        onReorderRecentConfigs={() => {}}
        onReorderProjectProfiles={() => {}}
        onReorderProfiles={() => {}}
      />
    );

    await waitFor(() => {
      expect(getFloatingCardMotionElement(container)?.style.transform).toContain(
        `translate3d(0px, ${ROW_STRIDE * 3}px, 0)`
      );
    });
  });

  it("点击排序按钮后会切换发布配置拖拽手柄的常驻显示", () => {
    const { container } = render(
      <PublishConfigPanel
        selectedPreset="release-fd"
        isCustomMode={true}
        profiles={[createProfile("alpha-profile"), createProfile("beta-profile")]}
        activeProfileName="alpha-profile"
        onSelectProfile={() => {}}
        onCreateProfile={() => {}}
        onEditProfile={() => {}}
        onRefreshProfiles={() => {}}
        onOpenConfigDialog={() => {}}
        onDeleteProfile={() => {}}
        dotnetSchema={dotnetSchema}
        projectPublishProfiles={[]}
        onSelectProjectProfile={() => {}}
        onCopyProjectProfileToCustom={async (_name, _config: PublishConfigStore) => "copied"}
        recentConfigKeys={[]}
        favoriteConfigKeys={[]}
        onToggleFavoriteConfig={() => {}}
        onRemoveRecentConfig={() => {}}
        onReorderRecentConfigs={() => {}}
        onReorderProjectProfiles={() => {}}
        onReorderProfiles={() => {}}
      />
    );

    const profileRow = container.querySelector<HTMLElement>(
      '[data-list-item-id="userprofile:alpha-profile"]'
    );
    expect(profileRow).not.toBeNull();
    const profileMainButton = profileRow!.querySelector<HTMLButtonElement>(
      "button[aria-pressed]"
    );
    expect(profileMainButton).not.toBeNull();

    expect(
      within(profileRow!).queryByRole("button", {
        name: "拖动排序",
      })
    ).toBeNull();
    expect(profileMainButton!.className).toContain("pl-3");

    fireEvent.click(
      screen.getByRole("button", {
        name: "开启排序",
      })
    );

    const dragHandle = within(profileRow!).getByRole("button", {
      name: "拖动排序",
    });
    expect(
      screen.getByRole("button", {
        name: "关闭排序",
      })
    ).toHaveAttribute("aria-pressed", "true");
    expect(dragHandle).toBeInTheDocument();
    expect(profileMainButton!.className).toContain("pl-10");
  });

  it("最近使用组越过相邻项中线后会实时冒泡，并按 preview 顺序提交", async () => {
    const onReorderRecentConfigs = vi.fn();

    const { container } = render(
      <PublishConfigPanel
        selectedPreset="release-fd"
        isCustomMode={true}
        profiles={[createProfile("alpha-profile"), createProfile("beta-profile")]}
        activeProfileName="alpha-profile"
        onSelectProfile={() => {}}
        onCreateProfile={() => {}}
        onEditProfile={() => {}}
        onRefreshProfiles={() => {}}
        onOpenConfigDialog={() => {}}
        onDeleteProfile={() => {}}
        dotnetSchema={dotnetSchema}
        projectPublishProfiles={[]}
        onSelectProjectProfile={() => {}}
        onCopyProjectProfileToCustom={async (_name, _config: PublishConfigStore) => "copied"}
        recentConfigKeys={[
          "userprofile:alpha-profile",
          "userprofile:beta-profile",
        ]}
        favoriteConfigKeys={[]}
        onToggleFavoriteConfig={() => {}}
        onRemoveRecentConfig={() => {}}
        onReorderRecentConfigs={onReorderRecentConfigs}
        onReorderProjectProfiles={() => {}}
        onReorderProfiles={() => {}}
      />
    );

    const sourceRow = container.querySelector<HTMLElement>(
      '[data-list-item-id="recent:userprofile:beta-profile"]'
    );
    const targetRow = container.querySelector<HTMLElement>(
      '[data-list-item-id="recent:userprofile:alpha-profile"]'
    );

    expect(sourceRow).not.toBeNull();
    expect(targetRow).not.toBeNull();

    fireEvent.click(
      screen.getByRole("button", {
        name: "开启排序",
      })
    );

    act(() => {
      fireEvent.pointerDown(
        within(sourceRow!).getByRole("button", { name: "拖动排序" }),
        {
          button: 0,
          clientX: 18,
          clientY: 78,
        }
      );
      fireEvent.pointerMove(window, {
        clientX: 30,
        clientY: 31,
      });
    });

    await waitFor(() => {
      expect(getRenderedConfigIds(container, "recent:")).toEqual([
        "recent:userprofile:alpha-profile",
        "recent:userprofile:beta-profile",
      ]);
    });

    act(() => {
      fireEvent.pointerMove(window, {
        clientX: 30,
        clientY: 29,
      });
    });

    await waitFor(() => {
      expect(getRenderedConfigIds(container, "recent:")).toEqual([
        "recent:userprofile:beta-profile",
        "recent:userprofile:alpha-profile",
      ]);
    });

    act(() => {
      fireEvent.pointerUp(window);
    });

    expect(onReorderRecentConfigs).toHaveBeenCalledWith([
      "userprofile:beta-profile",
      "userprofile:alpha-profile",
    ]);
  });

  it("项目发布配置组越过相邻项中线后会实时冒泡，并按 preview 顺序提交", async () => {
    const onReorderProjectProfiles = vi.fn();

    const { container } = render(
      <PublishConfigPanel
        selectedPreset="release-fd"
        isCustomMode={false}
        profiles={[]}
        activeProfileName={null}
        onSelectProfile={() => {}}
        onCreateProfile={() => {}}
        onEditProfile={() => {}}
        onRefreshProfiles={() => {}}
        onOpenConfigDialog={() => {}}
        onDeleteProfile={() => {}}
        dotnetSchema={dotnetSchema}
        projectPublishProfiles={["FolderProfile", "ZipProfile"]}
        onSelectProjectProfile={() => {}}
        onCopyProjectProfileToCustom={async (_name, _config: PublishConfigStore) => "copied"}
        recentConfigKeys={[]}
        favoriteConfigKeys={[]}
        onToggleFavoriteConfig={() => {}}
        onRemoveRecentConfig={() => {}}
        onReorderRecentConfigs={() => {}}
        onReorderProjectProfiles={onReorderProjectProfiles}
        onReorderProfiles={() => {}}
      />
    );

    const sourceRow = container.querySelector<HTMLElement>(
      '[data-list-item-id="pubxml:ZipProfile"]'
    );
    const targetRow = container.querySelector<HTMLElement>(
      '[data-list-item-id="pubxml:FolderProfile"]'
    );

    expect(sourceRow).not.toBeNull();
    expect(targetRow).not.toBeNull();

    fireEvent.click(
      screen.getByRole("button", {
        name: "开启排序",
      })
    );

    act(() => {
      fireEvent.pointerDown(
        within(sourceRow!).getByRole("button", { name: "拖动排序" }),
        { button: 0, clientY: 78 }
      );
      fireEvent.pointerMove(window, { clientY: 31 });
    });

    await waitFor(() => {
      expect(getRenderedConfigIds(container, "pubxml:")).toEqual([
        "pubxml:FolderProfile",
        "pubxml:ZipProfile",
      ]);
    });

    act(() => {
      fireEvent.pointerMove(window, { clientY: 29 });
    });

    await waitFor(() => {
      expect(getRenderedConfigIds(container, "pubxml:")).toEqual([
        "pubxml:ZipProfile",
        "pubxml:FolderProfile",
      ]);
    });

    act(() => {
      fireEvent.pointerUp(window);
    });

    expect(onReorderProjectProfiles).toHaveBeenCalledWith([
      "ZipProfile",
      "FolderProfile",
    ]);
  });

  it("自定义组越过目标项中线后会实时跨组冒泡，并在松手后提交分组归属", async () => {
    const onReorderProfiles = vi.fn();

    const { container } = render(
      <PublishConfigPanel
        selectedPreset="release-fd"
        isCustomMode={false}
        profiles={[
          createProfile("alpha-profile", "Group A"),
          createProfile("beta-profile", "Group B"),
          createProfile("gamma-profile", "Group B"),
        ]}
        activeProfileName={null}
        onSelectProfile={() => {}}
        onCreateProfile={() => {}}
        onEditProfile={() => {}}
        onRefreshProfiles={() => {}}
        onOpenConfigDialog={() => {}}
        onDeleteProfile={() => {}}
        dotnetSchema={dotnetSchema}
        projectPublishProfiles={[]}
        onSelectProjectProfile={() => {}}
        onCopyProjectProfileToCustom={async (_name, _config: PublishConfigStore) => "copied"}
        recentConfigKeys={[]}
        favoriteConfigKeys={[]}
        onToggleFavoriteConfig={() => {}}
        onRemoveRecentConfig={() => {}}
        onReorderRecentConfigs={() => {}}
        onReorderProjectProfiles={() => {}}
        onReorderProfiles={onReorderProfiles}
      />
    );

    const sourceRow = container.querySelector<HTMLElement>(
      '[data-list-item-id="userprofile:alpha-profile"]'
    );
    const targetRow = container.querySelector<HTMLElement>(
      '[data-list-item-id="userprofile:gamma-profile"]'
    );

    expect(sourceRow).not.toBeNull();
    expect(targetRow).not.toBeNull();

    fireEvent.click(
      screen.getByRole("button", {
        name: "开启排序",
      })
    );

    act(() => {
      fireEvent.pointerDown(
        within(sourceRow!).getByRole("button", { name: "拖动排序" }),
        { button: 0, clientY: 20 }
      );
      fireEvent.pointerMove(window, { clientY: 67 });
    });

    await waitFor(() => {
      expect(getRenderedConfigIds(container, "userprofile:")).toEqual([
        "userprofile:alpha-profile",
        "userprofile:beta-profile",
        "userprofile:gamma-profile",
      ]);
    });

    act(() => {
      fireEvent.pointerMove(window, { clientY: 69 });
    });

    await waitFor(() => {
      expect(getRenderedConfigIds(container, "userprofile:")).toEqual([
        "userprofile:beta-profile",
        "userprofile:alpha-profile",
        "userprofile:gamma-profile",
      ]);
    });

    act(() => {
      fireEvent.pointerUp(window);
    });

    expect(onReorderProfiles).toHaveBeenCalledTimes(1);
    expect(
      onReorderProfiles.mock.calls[0][0].map((profile: ConfigProfile) => ({
        name: profile.name,
        profileGroup: profile.profileGroup,
      }))
    ).toEqual([
      { name: "beta-profile", profileGroup: "Group B" },
      { name: "alpha-profile", profileGroup: "Group B" },
      { name: "gamma-profile", profileGroup: "Group B" },
    ]);
  });

  it("项目发布配置查看页保持只读表单一致，并在补充区展示未映射的 pubxml 信息", async () => {
    resolveDotnetProjectProfileMock.mockResolvedValue({
      profileName: "FolderProfile",
      filePath: "/repo/Properties/PublishProfiles/FolderProfile.pubxml",
      parsedProfile: {
        rootTagName: "Project",
        sections: [
          {
            id: "PropertyGroup-1",
            title: "PropertyGroup",
            tagName: "PropertyGroup",
            path: "PropertyGroup",
            attributes: {
              Condition: "'$(Configuration)'=='Release'",
            },
            entries: [
              {
                key: "Configuration",
                path: "Configuration",
                value: "Release",
                attributes: {},
              },
              {
                key: "PublishDir",
                path: "PublishDir",
                value: "/tmp/publish",
                attributes: {},
              },
            ],
          },
          {
            id: "ItemGroup-1",
            title: "ItemGroup",
            tagName: "ItemGroup",
            path: "ItemGroup",
            attributes: {},
            entries: [
              {
                key: "PublishItems › ResolvedFileToPublish",
                path: "PublishItems.ResolvedFileToPublish",
                value: "Never",
                attributes: {
                  Include: "wwwroot/appsettings.json",
                },
              },
            ],
          },
        ],
        rawXml: "<Project />",
      },
      parameters: {
        configuration: "Release",
      },
      editableConfig: {
        configuration: "Release",
        runtime: "win-x64",
        framework: "net8.0",
        selfContained: true,
        outputDir: "/tmp/publish",
        noBuild: false,
        noRestore: false,
        verbosity: "",
        noLogo: false,
        deleteExistingFiles: true,
        properties: {
          PublishProvider: "FileSystem",
          ProjectGuid: "{12345678-1234-1234-1234-1234567890AB}",
          _TargetId: "Folder",
          PublishSingleFile: "true",
        },
        define: [],
        useProfile: false,
        profileName: "",
      },
    });

    const { container } = render(
      <PublishConfigPanel
        selectedPreset="release-fd"
        isCustomMode={false}
        profiles={[]}
        activeProfileName={null}
        onSelectProfile={() => {}}
        onCreateProfile={() => {}}
        onEditProfile={() => {}}
        onRefreshProfiles={() => {}}
        onOpenConfigDialog={() => {}}
        onDeleteProfile={() => {}}
        dotnetSchema={dotnetSchema}
        projectPublishProfiles={["FolderProfile"]}
        projectFilePath="/repo/Project.csproj"
        projectFrameworkOptions={["net8.0", "net9.0"]}
        onSelectProjectProfile={() => {}}
        onCopyProjectProfileToCustom={async (_name, _config: PublishConfigStore) => "copied"}
        recentConfigKeys={[]}
        favoriteConfigKeys={[]}
        onToggleFavoriteConfig={() => {}}
        onRemoveRecentConfig={() => {}}
        onReorderRecentConfigs={() => {}}
        onReorderProjectProfiles={() => {}}
        onReorderProfiles={() => {}}
      />
    );

    const projectRow = container.querySelector<HTMLElement>(
      '[data-list-item-id="pubxml:FolderProfile"]'
    );
    expect(projectRow).not.toBeNull();

    const trigger = within(projectRow!).getByRole("button", {
      name: "更多操作: FolderProfile",
    });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);

    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "查看配置",
      })
    );

    await waitFor(() => {
      expect(resolveDotnetProjectProfileMock).toHaveBeenCalledWith({
        projectInfo: {
          root_path: "",
          project_file: "/repo/Project.csproj",
          target_frameworks: ["net8.0", "net9.0"],
        },
        profileName: "FolderProfile",
      });
    });

    expect(await screen.findByText("发布参数")).toBeInTheDocument();
    expect(screen.getByText("输出与部署")).toBeInTheDocument();
    expect(screen.getByText("高级参数")).toBeInTheDocument();
    expect(screen.getByText("/repo/Properties/PublishProfiles/FolderProfile.pubxml")).toBeInTheDocument();
    expect(screen.queryByText("dotnet publish 参数")).not.toBeInTheDocument();
    expect(screen.queryByText("发布相关 MSBuild 属性")).not.toBeInTheDocument();
    expect(screen.queryByText("配置文件参数统计")).not.toBeInTheDocument();
    expect(screen.queryByText("PublishItems › ResolvedFileToPublish")).not.toBeInTheDocument();
    expect(screen.queryByText("原始配置文件")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "主表单与新建、编辑配置保持一致；其余无法在表单里完整表达的 .pubxml 信息收起在下方补充区中。"
      )
    ).toBeInTheDocument();

    expect(
      screen.getByRole("combobox", {
        name: "配置类型",
      })
    ).toBeDisabled();
    expect(
      screen.getByRole("textbox", {
        name: "输出目录",
      })
    ).toHaveAttribute("readonly");
    expect(
      screen.getByRole("switch", {
        name: "自包含部署",
      })
    ).toBeDisabled();
    expect(screen.queryByRole("button", { name: /remove item/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remove entry/i })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "目标框架" })).toHaveValue("net8.0");
    expect(screen.getByRole("switch", { name: "发布前清空目标目录" })).toBeChecked();
    expect(
      screen.getByRole("combobox", { name: "上次使用的构建配置" })
    ).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "发布提供程序" })).toHaveValue("FileSystem");
    expect(
      screen.getAllByRole("switch", { name: "发布前清空目标目录" })
    ).toHaveLength(1);
    expect(screen.queryByRole("textbox", { name: "目标 ID" })).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: /其余参数/,
      })
    );

    expect(screen.getByRole("textbox", { name: "目标 ID" })).toHaveValue("Folder");
    expect(screen.getByRole("switch", { name: "单文件发布" })).toBeChecked();
    expect(screen.getByRole("combobox", { name: "日志详细级别" })).toBeDisabled();
    expect(screen.getByText("当前未设置条件编译常量。")).toBeInTheDocument();

    const parsedFieldsToggle = screen.getByRole("button", {
      name: /完整解析参数/,
    });
    fireEvent.click(parsedFieldsToggle);

    expect(screen.getByText("PropertyGroup")).toBeInTheDocument();
    expect(screen.getByText("标签: PropertyGroup")).toBeInTheDocument();
    expect(screen.getByText("Condition")).toBeInTheDocument();
    expect(screen.getByText("'$(Configuration)'=='Release'")).toBeInTheDocument();
    expect(
      screen.getByText("PublishItems › ResolvedFileToPublish")
    ).toBeInTheDocument();
    expect(
      screen.getByText("PublishItems.ResolvedFileToPublish")
    ).toBeInTheDocument();
    expect(screen.getByText("Never")).toBeInTheDocument();
  });

  it("项目发布配置完全可映射时不显示补充折叠区", async () => {
    resolveDotnetProjectProfileMock.mockResolvedValue({
      profileName: "ReleaseProfile",
      filePath: "/repo/Properties/PublishProfiles/ReleaseProfile.pubxml",
      parsedProfile: {
        rootTagName: "Project",
        rawXml: "<Project />",
        sections: [
          {
            id: "PropertyGroup-1",
            title: "PropertyGroup",
            tagName: "PropertyGroup",
            path: "PropertyGroup",
            attributes: {},
            entries: [
              {
                key: "Configuration",
                path: "Configuration",
                value: "Release",
                attributes: {},
              },
              {
                key: "RuntimeIdentifier",
                path: "RuntimeIdentifier",
                value: "win-x64",
                attributes: {},
              },
              {
                key: "PublishDir",
                path: "PublishDir",
                value: "/tmp/publish",
                attributes: {},
              },
              {
                key: "PublishSingleFile",
                path: "PublishSingleFile",
                value: "true",
                attributes: {},
              },
            ],
          },
        ],
      },
      parameters: {
        configuration: "Release",
      },
      editableConfig: {
        configuration: "Release",
        runtime: "win-x64",
        framework: "",
        selfContained: false,
        outputDir: "/tmp/publish",
        noBuild: false,
        noRestore: false,
        verbosity: "",
        noLogo: false,
        deleteExistingFiles: false,
        properties: {
          PublishSingleFile: "true",
        },
        define: [],
        useProfile: false,
        profileName: "",
      },
    });

    const { container } = render(
      <PublishConfigPanel
        selectedPreset="release-fd"
        isCustomMode={false}
        profiles={[]}
        activeProfileName={null}
        onSelectProfile={() => {}}
        onCreateProfile={() => {}}
        onEditProfile={() => {}}
        onRefreshProfiles={() => {}}
        onOpenConfigDialog={() => {}}
        onDeleteProfile={() => {}}
        dotnetSchema={dotnetSchema}
        projectPublishProfiles={["ReleaseProfile"]}
        projectFilePath="/repo/Project.csproj"
        projectFrameworkOptions={["net8.0"]}
        onSelectProjectProfile={() => {}}
        onCopyProjectProfileToCustom={async (_name, _config: PublishConfigStore) => "copied"}
        recentConfigKeys={[]}
        favoriteConfigKeys={[]}
        onToggleFavoriteConfig={() => {}}
        onRemoveRecentConfig={() => {}}
        onReorderRecentConfigs={() => {}}
        onReorderProjectProfiles={() => {}}
        onReorderProfiles={() => {}}
      />
    );

    const projectRow = container.querySelector<HTMLElement>(
      '[data-list-item-id="pubxml:ReleaseProfile"]'
    );
    expect(projectRow).not.toBeNull();

    const trigger = within(projectRow!).getByRole("button", {
      name: "更多操作: ReleaseProfile",
    });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);

    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "查看配置",
      })
    );

    await screen.findByText("发布参数");

    expect(
      screen.queryByRole("button", {
        name: /完整解析参数/,
      })
    ).not.toBeInTheDocument();
  });
});
