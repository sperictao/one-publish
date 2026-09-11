import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { RepositoryList } from "@/components/layout/RepositoryList";
import { __setTranslationsCacheForTest } from "@/hooks/useI18n";
import type { Repository } from "@/lib/store/types";
import { defaultRepoPublishConfig } from "@/lib/store/types";

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

function getRenderedRepoIds(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      ".repo-list-grid [data-list-item-id]"
    )
  ).map((row) => row.dataset.listItemId ?? "");
}

let getBoundingClientRectSpy: ReturnType<typeof vi.spyOn> | null = null;

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

  getBoundingClientRectSpy = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function mockRect(this: HTMLElement) {
      const rowElement = this.matches("[data-list-row='true']")
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
        selectRepository: "选择仓库",
        moreActions: "更多操作",
        openRepositoryDirectory: "打开目录",
        editRepositoryAction: "编辑仓库",
        removeRepositoryAction: "移除仓库",
        addRepository: "添加仓库",
        showReorderControls: "开启排序",
        hideReorderControls: "关闭排序",
        searchRepository: "搜索仓库",
        all: "全部",
        currentBranchUnknown: "未知分支",
        noRepositories: "暂无仓库",
        noRepositoriesHint: "点击上方 + 添加仓库",
        noMatchingRepositories: "没有匹配的仓库",
        openSettings: "打开设置",
      },
    },
  });
});

afterAll(() => {
  getBoundingClientRectSpy?.mockRestore();
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
        onOpenRepoDirectory={() => {}}
        onEditRepo={() => true}
        onRemoveRepo={() => {}}
        onDetectProvider={async () => null}
        onScanProjectCandidates={async () => null}
        onRefreshBranches={async () => null}
        branchConnectivityByRepoId={{}}
        actualBranchByRepoId={{}}
        onSettings={() => {}}
        onReorderRepositories={() => {}}
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "选择仓库: beta-worker" })
    );

    expect(onSelectRepo).toHaveBeenCalledWith("repo-b");
  });

  it("仓库项分支优先展示实际扫描分支，未扫描到时回退存储分支", () => {
    render(
      <RepositoryList
        repositories={[
          createRepository("repo-a", "alpha-service"),
          createRepository("repo-b", "beta-worker"),
        ]}
        selectedRepoId="repo-a"
        providers={[]}
        onSelectRepo={() => {}}
        onAddRepo={() => {}}
        onOpenRepoDirectory={() => {}}
        onEditRepo={() => true}
        onRemoveRepo={() => {}}
        onDetectProvider={async () => null}
        onScanProjectCandidates={async () => null}
        onRefreshBranches={async () => null}
        branchConnectivityByRepoId={{}}
        actualBranchByRepoId={{ "repo-a": "feature/login" }}
        onSettings={() => {}}
        onReorderRepositories={() => {}}
      />
    );

    const repoAButton = screen.getByRole("button", {
      name: "选择仓库: alpha-service",
    });
    const repoBButton = screen.getByRole("button", {
      name: "选择仓库: beta-worker",
    });

    expect(within(repoAButton).getByText("feature/login")).toBeInTheDocument();
    expect(within(repoBButton).getByText("main")).toBeInTheDocument();
  });

  it("打开未选中仓库菜单时不会误选中，并在离开列表后仍锁定菜单上下文", async () => {
    const onSelectRepo = vi.fn();
    const onOpenRepoDirectory = vi.fn();
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
        onOpenRepoDirectory={onOpenRepoDirectory}
        onEditRepo={() => true}
        onRemoveRepo={onRemoveRepo}
        onDetectProvider={async () => null}
        onScanProjectCandidates={async () => null}
        onRefreshBranches={async () => null}
        branchConnectivityByRepoId={{ "repo-a": true, "repo-b": false }}
        actualBranchByRepoId={{}}
        onSettings={() => {}}
        onReorderRepositories={() => {}}
      />
    );

    const repoBRow = container.querySelector<HTMLElement>(
      '[data-list-item-id="repo-b"]'
    );
    expect(repoBRow).not.toBeNull();

    const list = container.querySelector<HTMLElement>(".list-scroll-shell");
    expect(list).not.toBeNull();

    fireEvent.pointerEnter(list!);
    fireEvent.mouseOver(repoBRow!);
    await waitFor(() => {
      expect(repoBRow).toHaveAttribute("data-list-visual-target", "true");
    });
    expect(container.querySelector(".floating-list-card")).toBeNull();

    const trigger = screen.getByRole("button", {
      name: "更多操作: beta-worker",
    });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);

    const openRepositoryDirectoryItem = await screen.findByRole("menuitem", {
      name: "打开目录",
    });
    expect(onSelectRepo).not.toHaveBeenCalled();
    const repoBRowAfterOpen = container.querySelector<HTMLElement>(
      '[data-list-item-id="repo-b"]'
    );

    fireEvent.pointerLeave(list!);

    expect(repoBRowAfterOpen).toHaveAttribute("data-list-menu-open", "true");
    expect(repoBRowAfterOpen).toHaveAttribute(
      "data-list-visual-target",
      "true"
    );

    fireEvent.click(openRepositoryDirectoryItem);

    await waitFor(() => {
      expect(onOpenRepoDirectory).toHaveBeenCalledTimes(1);
    });
    expect(onOpenRepoDirectory.mock.calls[0][0].id).toBe("repo-b");
    expect(onSelectRepo).not.toHaveBeenCalled();

    const triggerAfterDirectoryAction = screen.getByRole("button", {
      name: "更多操作: beta-worker",
    });
    fireEvent.pointerDown(triggerAfterDirectoryAction, {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(triggerAfterDirectoryAction);

    const removeItemAfterReopen = await screen.findByRole("menuitem", {
      name: "移除仓库",
    });
    fireEvent.click(removeItemAfterReopen);

    await waitFor(() => {
      expect(onRemoveRepo).toHaveBeenCalledTimes(1);
    });
    expect(onRemoveRepo.mock.calls[0][0].id).toBe("repo-b");
    expect(onSelectRepo).not.toHaveBeenCalled();
  });

  it("点击排序按钮后会切换仓库拖拽手柄的常驻显示", () => {
    const { container } = render(
      <RepositoryList
        repositories={[
          createRepository("repo-a", "alpha-service"),
          createRepository("repo-b", "beta-worker"),
        ]}
        selectedRepoId="repo-a"
        providers={[]}
        onSelectRepo={() => {}}
        onAddRepo={() => {}}
        onOpenRepoDirectory={() => {}}
        onEditRepo={() => true}
        onRemoveRepo={() => {}}
        onDetectProvider={async () => null}
        onScanProjectCandidates={async () => null}
        onRefreshBranches={async () => null}
        branchConnectivityByRepoId={{}}
        actualBranchByRepoId={{}}
        onSettings={() => {}}
        onReorderRepositories={() => {}}
      />
    );

    const repoRow = container.querySelector<HTMLElement>(
      '[data-list-item-id="repo-a"]'
    );
    expect(repoRow).not.toBeNull();
    const repoMainButton = within(repoRow!).getByRole("button", {
      name: "选择仓库: alpha-service",
    });

    expect(
      within(repoRow!).queryByRole("button", {
        name: "拖动排序",
      })
    ).toBeNull();
    expect(repoMainButton.className).toContain("pl-3");

    fireEvent.click(
      screen.getByRole("button", {
        name: "开启排序",
      })
    );

    const dragHandle = within(repoRow!).getByRole("button", {
      name: "拖动排序",
    });
    expect(
      screen.getByRole("button", {
        name: "关闭排序",
      })
    ).toHaveAttribute("aria-pressed", "true");
    expect(dragHandle).toBeInTheDocument();
    expect(repoMainButton.className).toContain("pl-10");
  });

  it("拖动仓库排序时越过相邻项中线后会实时冒泡，并按 preview 顺序提交", async () => {
    const onReorderRepositories = vi.fn();

    const { container } = render(
      <RepositoryList
        repositories={[
          createRepository("repo-a", "alpha-service"),
          createRepository("repo-b", "beta-worker"),
          createRepository("repo-c", "charlie-api"),
        ]}
        selectedRepoId="repo-a"
        providers={[]}
        onSelectRepo={() => {}}
        onAddRepo={() => {}}
        onOpenRepoDirectory={() => {}}
        onEditRepo={() => true}
        onRemoveRepo={() => {}}
        onDetectProvider={async () => null}
        onScanProjectCandidates={async () => null}
        onRefreshBranches={async () => null}
        branchConnectivityByRepoId={{}}
        actualBranchByRepoId={{}}
        onSettings={() => {}}
        onReorderRepositories={onReorderRepositories}
      />
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "开启排序",
      })
    );

    const dragHandles = screen.getAllByRole("button", { name: "拖动排序" });
    const sourceRow = container.querySelector<HTMLElement>(
      '[data-list-item-id="repo-c"]'
    );
    const repoBRow = container.querySelector<HTMLElement>(
      '[data-list-item-id="repo-b"]'
    );

    expect(dragHandles).toHaveLength(3);
    expect(sourceRow).not.toBeNull();
    expect(repoBRow).not.toBeNull();

    act(() => {
      fireEvent.pointerDown(dragHandles[2], {
        button: 0,
        clientX: 14,
        clientY: 126,
      });
      fireEvent.pointerMove(window, {
        clientX: 26,
        clientY: 79,
      });
    });

    await waitFor(() => {
      expect(getRenderedRepoIds(container)).toEqual([
        "repo-a",
        "repo-b",
        "repo-c",
      ]);
    });

    act(() => {
      fireEvent.pointerMove(window, {
        clientX: 26,
        clientY: 77,
      });
    });

    await waitFor(() => {
      expect(getRenderedRepoIds(container)).toEqual([
        "repo-a",
        "repo-c",
        "repo-b",
      ]);
    });

    act(() => {
      fireEvent.pointerUp(window);
    });

    expect(onReorderRepositories).toHaveBeenCalledWith([
      "repo-a",
      "repo-c",
      "repo-b",
    ]);
  });
});

describe("RepositoryList · 添加仓库入口与反馈", () => {
  const baseProps = {
    selectedRepoId: null,
    providers: [{ id: "java", displayName: "java", label: "Java (Gradle)" }],
    onSelectRepo: () => {},
    onOpenRepoDirectory: () => {},
    onEditRepo: () => true,
    onRemoveRepo: () => {},
    onDetectProvider: async () => null,
    onScanProjectCandidates: async () => null,
    onRefreshBranches: async () => null,
    branchConnectivityByRepoId: {},
    actualBranchByRepoId: {},
    onSettings: () => {},
    onReorderRepositories: () => {},
  };

  it("添加流程进行中时入口 disabled + aria-busy，阻止并发触发第二个目录选择器", () => {
    render(
      <RepositoryList
        {...baseProps}
        repositories={[]}
        onAddRepo={() => {}}
        isAddingRepo
      />
    );

    const addButton = screen.getByTestId("repo-add-button");
    expect(addButton).toBeDisabled();
    expect(addButton).toHaveAttribute("aria-busy", "true");
    expect(addButton).toHaveAttribute("aria-label", "添加仓库");
  });

  it("空闲时入口可点击且不带 aria-busy", () => {
    const onAddRepo = vi.fn();
    render(
      <RepositoryList {...baseProps} repositories={[]} onAddRepo={onAddRepo} />
    );

    const addButton = screen.getByTestId("repo-add-button");
    expect(addButton).not.toBeDisabled();
    expect(addButton).toHaveAttribute("aria-busy", "false");

    fireEvent.click(addButton);
    expect(onAddRepo).toHaveBeenCalledTimes(1);
  });

  it("空态提供主行动按钮，并把引导文案指向工具栏的 + 按钮", () => {
    const onAddRepo = vi.fn();
    render(
      <RepositoryList {...baseProps} repositories={[]} onAddRepo={onAddRepo} />
    );

    expect(screen.getByText("点击上方 + 添加仓库")).toBeTruthy();

    const emptyStateAction = screen
      .getAllByRole("button", { name: "添加仓库" })
      .find((button) => button.dataset.testid !== "repo-add-button");

    expect(emptyStateAction).toBeTruthy();
    fireEvent.click(emptyStateAction as HTMLElement);
    expect(onAddRepo).toHaveBeenCalledTimes(1);
  });

  it("搜索无结果时不再提示添加仓库，而是提示没有匹配项", () => {
    render(
      <RepositoryList
        {...baseProps}
        repositories={[createRepository("repo-a", "alpha-service")]}
        onAddRepo={() => {}}
      />
    );

    fireEvent.change(screen.getByTestId("repo-search-input"), {
      target: { value: "zzz" },
    });

    expect(screen.getByText("没有匹配的仓库")).toBeTruthy();
    expect(screen.queryByText("点击上方 + 添加仓库")).toBeNull();
  });

  it("仓库总数是纯展示计数标签，不再是会动但无后果的按钮", () => {
    render(
      <RepositoryList
        {...baseProps}
        repositories={[createRepository("repo-a", "alpha-service")]}
        onAddRepo={() => {}}
      />
    );

    const countLabel = screen.getByTestId("repo-count-label");
    expect(countLabel.tagName).toBe("SPAN");
    expect(countLabel.textContent).toBe("全部1");
  });

  it("仓库行徽标使用 Provider 展示名，与编辑对话框一致", () => {
    render(
      <RepositoryList
        {...baseProps}
        repositories={[
          {
            ...createRepository("repo-java", "payments-api"),
            providerId: "java",
          },
        ]}
        onAddRepo={() => {}}
      />
    );

    const badge = screen.getByTestId("repo-provider-badge");
    expect(badge.textContent).toBe("Java (Gradle)");
    expect(badge).toHaveAttribute("title", "Java (Gradle)");
  });

  it("搜索过滤生效时添加仓库，新行会被清空筛选后重新可见（M1）", async () => {
    const alpha = createRepository("repo-alpha", "alpha-service");
    const added = createRepository("repo-new", "payments-api");
    const onAddRepo = vi.fn().mockResolvedValue({
      status: "added",
      repoId: "repo-new",
      name: "payments-api",
      path: "/tmp/payments-api",
    });

    const { container, rerender } = render(
      <RepositoryList
        {...baseProps}
        repositories={[alpha]}
        onAddRepo={onAddRepo}
      />
    );

    fireEvent.change(screen.getByTestId("repo-search-input"), {
      target: { value: "alpha" },
    });

    expect(getRenderedRepoIds(container)).toEqual(["repo-alpha"]);

    await act(async () => {
      fireEvent.click(screen.getByTestId("repo-add-button"));
    });

    rerender(
      <RepositoryList
        {...baseProps}
        repositories={[alpha, added]}
        onAddRepo={onAddRepo}
      />
    );

    await waitFor(() => {
      expect(getRenderedRepoIds(container)).toEqual(["repo-alpha", "repo-new"]);
    });

    expect(
      (screen.getByTestId("repo-search-input") as HTMLInputElement).value
    ).toBe("");
  });
});
