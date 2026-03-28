import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PublishConfigPanel } from "@/components/layout/PublishConfigPanel";
import { __setTranslationsCacheForTest } from "@/hooks/useI18n";
import type { ConfigProfile, PublishConfigStore } from "@/lib/store";

function createProfile(name: string): ConfigProfile {
  return {
    name,
    providerId: "dotnet",
    parameters: {},
    createdAt: new Date().toISOString(),
    isSystemDefault: false,
  };
}

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
      value: () => [],
    });
  }

  if (!HTMLElement.prototype.animate) {
    Object.defineProperty(HTMLElement.prototype, "animate", {
      value: () => ({
        cancel() {},
      }),
    });
  }

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
        favoriteConfig: "收藏配置",
        unfavoriteConfig: "取消收藏",
        removeRecent: "从最近使用移除",
        deleteConfig: "删除配置",
        editConfig: "编辑配置",
        searchConfig: "搜索配置",
      },
    },
  });
});

beforeEach(() => {
  localStorage.setItem("app-language", "zh");
});

describe("PublishConfigPanel", () => {
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
        projectPublishProfiles={[]}
        onSelectProjectProfile={onSelectProjectProfile}
        onCopyProjectProfileToCustom={async (_name, _config: PublishConfigStore) => "copied"}
        recentConfigKeys={["userprofile:beta-profile"]}
        favoriteConfigKeys={[]}
        onToggleFavoriteConfig={() => {}}
        onRemoveRecentConfig={onRemoveRecentConfig}
      />
    );

    const recentRow = container.querySelector<HTMLElement>(
      '[data-list-item-id="recent:userprofile:beta-profile"]'
    );
    expect(recentRow).not.toBeNull();

    const list = container.querySelector<HTMLElement>(".list-scroll-shell");
    expect(list).not.toBeNull();

    fireEvent.pointerEnter(list!);
    fireEvent.mouseOver(recentRow!);

    await waitFor(() => {
      expect(recentRow).toHaveAttribute("data-list-visual-target", "true");
    });

    const trigger = within(recentRow!).getByRole("button", {
      name: "更多操作: beta-profile",
    });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);

    const removeRecentItem = await screen.findByRole("menuitem", {
      name: "从最近使用移除",
    });

    expect(onSelectProfile).not.toHaveBeenCalled();
    expect(onSelectProjectProfile).not.toHaveBeenCalled();

    fireEvent.pointerLeave(list!);

    expect(recentRow).toHaveAttribute("data-list-menu-open", "true");
    expect(recentRow).toHaveAttribute("data-list-visual-target", "true");

    fireEvent.click(removeRecentItem);

    await waitFor(() => {
      expect(onRemoveRecentConfig).toHaveBeenCalledWith("userprofile:beta-profile");
    });
    expect(onSelectProfile).not.toHaveBeenCalled();
    expect(onSelectProjectProfile).not.toHaveBeenCalled();
  });
});
