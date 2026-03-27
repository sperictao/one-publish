import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RepositoryList } from "@/components/layout/RepositoryList";
import { __setTranslationsCacheForTest } from "@/hooks/useI18n";
import type { Repository } from "@/types/repository";
import { defaultRepoPublishConfig } from "@/lib/store";

function createRepository(id: string, name: string): Repository {
  return {
    id,
    name,
    path: `/tmp/${name}`,
    currentBranch: "main",
    branches: [],
    providerId: "dotnet",
    publishConfig: { ...defaultRepoPublishConfig },
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
        selectRepository: "选择仓库",
        moreActions: "更多操作",
        edit: "编辑",
        remove: "移除",
        addRepository: "添加仓库",
        searchRepository: "搜索仓库",
        all: "全部",
        currentBranchUnknown: "未知分支",
      },
    },
  });
});

beforeEach(() => {
  localStorage.setItem("app-language", "zh");
});

describe("RepositoryList", () => {
  it("点击仓库主按钮会选中对应仓库", () => {
    const onSelectRepo = vi.fn();

    render(
      <RepositoryList
        repositories={[
          createRepository("repo-a", "alpha-service"),
          createRepository("repo-b", "beta-worker"),
        ]}
        selectedRepoId="repo-a"
        providers={[]}
        onSelectRepo={onSelectRepo}
        onAddRepo={() => {}}
        onEditRepo={() => true}
        onRemoveRepo={() => {}}
        onDetectProvider={async () => null}
        onScanProjectFiles={async () => []}
        onRefreshBranches={async () => null}
        branchConnectivityByRepoId={{}}
        onSettings={() => {}}
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "选择仓库: beta-worker" })
    );

    expect(onSelectRepo).toHaveBeenCalledWith("repo-b");
  });

  it("打开未选中仓库菜单时不会误选中，并在离开列表后仍锁定菜单上下文", async () => {
    const onSelectRepo = vi.fn();
    const onRemoveRepo = vi.fn();

    const { container } = render(
      <RepositoryList
        repositories={[
          createRepository("repo-a", "alpha-service"),
          createRepository("repo-b", "beta-worker"),
        ]}
        selectedRepoId="repo-a"
        providers={[]}
        onSelectRepo={onSelectRepo}
        onAddRepo={() => {}}
        onEditRepo={() => true}
        onRemoveRepo={onRemoveRepo}
        onDetectProvider={async () => null}
        onScanProjectFiles={async () => []}
        onRefreshBranches={async () => null}
        branchConnectivityByRepoId={{ "repo-a": true, "repo-b": false }}
        onSettings={() => {}}
      />
    );

    const repoBRow = container.querySelector<HTMLElement>(
      '[data-repo-id="repo-b"]'
    );
    expect(repoBRow).not.toBeNull();

    const list = container.querySelector<HTMLElement>(".repo-list-scroll");
    expect(list).not.toBeNull();

    fireEvent.pointerEnter(list!);
    fireEvent.mouseOver(repoBRow!);
    await waitFor(() => {
      expect(repoBRow).toHaveAttribute("data-visual-target", "true");
    });

    const trigger = screen.getByRole("button", {
      name: "更多操作: beta-worker",
    });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);

    const removeItem = await screen.findByRole("menuitem", { name: "移除" });
    expect(onSelectRepo).not.toHaveBeenCalled();
    const repoBRowAfterOpen = container.querySelector<HTMLElement>(
      '[data-repo-id="repo-b"]'
    );

    fireEvent.pointerLeave(list!);

    expect(repoBRowAfterOpen).toHaveAttribute("data-menu-open", "true");
    expect(repoBRowAfterOpen).toHaveAttribute("data-visual-target", "true");

    fireEvent.click(removeItem);

    await waitFor(() => {
      expect(onRemoveRepo).toHaveBeenCalledTimes(1);
    });
    expect(onRemoveRepo.mock.calls[0][0].id).toBe("repo-b");
    expect(onSelectRepo).not.toHaveBeenCalled();
  });
});
