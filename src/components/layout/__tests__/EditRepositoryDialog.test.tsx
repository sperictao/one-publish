import { describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { EditRepositoryDialog } from "@/components/layout/EditRepositoryDialog";
import type {
  Branch,
  ProjectScanCandidates,
  Repository,
} from "@/lib/store/types";

type ScanCandidatesFn = (
  path: string,
  providerId?: string
) => Promise<ProjectScanCandidates | null>;

const GAMMA_CANDIDATES = {
  rootPath: "/workspace/gamma-tool",
  solutionFiles: ["/workspace/gamma-tool/Multi.sln"],
  projectFiles: [
    "/workspace/gamma-tool/App.csproj",
    "/workspace/gamma-tool/Tests.csproj",
  ],
  recommendedProjectFile: "/workspace/gamma-tool/App.csproj",
};

const BRANCHES: Branch[] = [
  {
    name: "main",
    isMain: true,
    isCurrent: true,
    path: "/workspace/gamma-tool",
    commitCount: 3,
  },
];

function createRepositoryWithoutBinding(): Repository {
  return {
    id: "repo-c",
    name: "gamma-tool",
    path: "/workspace/gamma-tool",
    currentBranch: "main",
    isMain: false,
    providerId: null,
    projectFile: null,
    branches: BRANCHES,
    publishConfig: {
      profiles: [],
      bindings: [],
      appliedBundles: [],
      drafts: [],
    },
  };
}

function renderDialog(overrides?: {
  onScanProjectCandidates?: ScanCandidatesFn;
  onDetectProvider?: (
    path: string,
    options?: { silentSuccess?: boolean; silentFailure?: boolean }
  ) => Promise<string | null>;
  onRefreshBranches?: (
    path: string,
    options?: { silentSuccess?: boolean }
  ) => Promise<{ branches: Branch[]; currentBranch: string } | null>;
}) {
  const onScanProjectCandidates: ScanCandidatesFn =
    overrides?.onScanProjectCandidates ??
    (vi.fn().mockResolvedValue(GAMMA_CANDIDATES) as ScanCandidatesFn);
  const onDetectProvider =
    overrides?.onDetectProvider ?? vi.fn().mockResolvedValue("dotnet");
  const onRefreshBranches =
    overrides?.onRefreshBranches ??
    vi.fn().mockResolvedValue({ branches: BRANCHES, currentBranch: "main" });

  render(
    <EditRepositoryDialog
      repository={createRepositoryWithoutBinding()}
      providers={[
        {
          id: "dotnet",
          displayName: ".NET SDK",
          label: ".NET SDK",
          requiresProjectBinding: true,
        },
      ]}
      repoT={{}}
      onOpenChange={vi.fn()}
      onEditRepo={vi.fn().mockResolvedValue(true)}
      onDetectProvider={onDetectProvider}
      onScanProjectCandidates={onScanProjectCandidates}
      onRefreshBranches={onRefreshBranches}
    />
  );

  return { onScanProjectCandidates, onDetectProvider, onRefreshBranches };
}

describe("EditRepositoryDialog 初始焦点", () => {
  it("打开后聚焦仓库名称输入框，标题 HelpTip 不抢焦点也不自动弹出提示", async () => {
    renderDialog();

    const nameInput = await screen.findByLabelText("仓库名称");
    await waitFor(() => {
      expect(nameInput).toHaveFocus();
    });
    expect(
      screen.getByRole("button", { name: "编辑项目信息" })
    ).not.toHaveFocus();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});

describe("EditRepositoryDialog 自动绑定推荐项目文件", () => {
  it("无绑定的多项目仓库打开后应回填推荐 Project File 并允许保存", async () => {
    renderDialog();

    // 等待 250ms 防抖扫描 + 自动检测完成；修复前 Radix 隐藏原生 select
    // 会把程序化变更回显为空值 change 并抹掉回填（回归哨兵）。
    const saveButton = await screen.findByRole("button", { name: "保存" });
    await waitFor(
      () => {
        expect(saveButton).not.toBeDisabled();
      },
      { timeout: 3_000 }
    );

    const trigger = screen.getByLabelText("Project File");
    await waitFor(() => {
      expect(within(trigger).getByText("App.csproj")).toBeVisible();
    });
  });

  it("扫描失败时保持手动输入模式且不阻断保存", async () => {
    renderDialog({
      onScanProjectCandidates: vi.fn().mockResolvedValue(null),
    });

    const saveButton = await screen.findByRole("button", { name: "保存" });
    await waitFor(
      () => {
        expect(saveButton).not.toBeDisabled();
      },
      { timeout: 3_000 }
    );
    expect(
      screen.queryByText("先选择一个 Project File。")
    ).not.toBeInTheDocument();
  });
});

describe("EditRepositoryDialog 路径变化作废在途手动操作", () => {
  it("路径变化后迟到的 Provider 检测结果不回填表单", async () => {
    const resolvers: Array<(value: string | null) => void> = [];
    const onDetectProvider = vi.fn().mockImplementation(
      () =>
        new Promise<string | null>((resolve) => {
          resolvers.push(resolve);
        })
    );
    renderDialog({ onDetectProvider });

    // 打开时无 Provider 会自动触发一次检测；返回 null 保持未设置。
    await waitFor(() => {
      expect(onDetectProvider).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      resolvers[0](null);
    });

    fireEvent.click(screen.getByRole("button", { name: "自动检测 Provider" }));
    await waitFor(() => {
      expect(onDetectProvider).toHaveBeenCalledTimes(2);
    });

    fireEvent.change(screen.getByLabelText("Project Root"), {
      target: { value: "/workspace/moved-elsewhere" },
    });
    await act(async () => {
      resolvers[1]("dotnet");
    });

    expect(screen.getByLabelText("Provider")).toHaveTextContent("未设置");
    expect(
      screen.getByRole("button", { name: "自动检测 Provider" })
    ).not.toBeDisabled();
  });

  it("路径变化后迟到的分支刷新结果不回填表单", async () => {
    const resolvers: Array<
      (value: { branches: Branch[]; currentBranch: string } | null) => void
    > = [];
    const onRefreshBranches = vi.fn().mockImplementation(
      () =>
        new Promise<{ branches: Branch[]; currentBranch: string } | null>(
          (resolve) => {
            resolvers.push(resolve);
          }
        )
    );
    renderDialog({ onRefreshBranches });

    // 打开时的自动分支刷新先落定（占用 resolvers[0]），手动刷新成为第二次调用。
    await waitFor(() => {
      expect(onRefreshBranches).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      resolvers[0]({ branches: BRANCHES, currentBranch: "main" });
    });

    const refreshButton = screen.getByRole("button", { name: "刷新分支" });
    await waitFor(() => {
      expect(refreshButton).not.toBeDisabled();
    });

    fireEvent.click(refreshButton);
    await waitFor(() => {
      expect(onRefreshBranches).toHaveBeenCalledTimes(2);
    });

    fireEvent.change(screen.getByLabelText("Project Root"), {
      target: { value: "/workspace/moved-elsewhere" },
    });
    await act(async () => {
      resolvers[1]({
        branches: [
          {
            name: "dev",
            isMain: false,
            isCurrent: true,
            path: "/workspace/moved-elsewhere",
            commitCount: 0,
          },
        ],
        currentBranch: "dev",
      });
    });

    expect(screen.getByLabelText("当前分支")).toHaveTextContent("main");
    expect(screen.getByRole("button", { name: "刷新分支" })).not.toBeDisabled();
  });
});
