import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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
}) {
  const onScanProjectCandidates: ScanCandidatesFn =
    overrides?.onScanProjectCandidates ??
    (vi.fn().mockResolvedValue(GAMMA_CANDIDATES) as ScanCandidatesFn);

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
      onDetectProvider={vi.fn().mockResolvedValue("dotnet")}
      onScanProjectCandidates={onScanProjectCandidates}
      onRefreshBranches={vi
        .fn()
        .mockResolvedValue({ branches: BRANCHES, currentBranch: "main" })}
    />
  );

  return { onScanProjectCandidates };
}

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
