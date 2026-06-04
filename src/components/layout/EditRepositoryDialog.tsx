import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { cn } from "@/lib/utils";
import { getPathRelativeToRoot } from "@/lib/paths";
import { AppDialogInset } from "@/components/ui/app-dialog-inset";
import { AppDialogShell } from "@/components/ui/app-dialog-shell";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { FileSearch, FolderGit2, RefreshCw, GitBranch, Activity, Info, HelpCircle } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { ProjectScanCandidates } from "@/lib/store/types";
import type { Branch, Repository } from "@/lib/store/types";
import {
  repositoryProjectBindingPending,
  reconcileProjectBinding,
  repositoryRequiresProjectBinding,
} from "@/components/layout/editRepositoryProjectBinding";

interface ProviderOption {
  id: string;
  displayName: string;
  label?: string;
  requiresProjectBinding?: boolean;
}

interface EditRepositoryDialogProps {
  repository: Repository | null;
  providers: ProviderOption[];
  repoT: Record<string, string | undefined>;
  onOpenChange: (open: boolean) => void;
  onEditRepo: (repo: Repository) => Promise<boolean> | boolean;
  onDetectProvider: (
    path: string,
    options?: { silentSuccess?: boolean }
  ) => Promise<string | null>;
  onScanProjectCandidates: (path: string) => Promise<ProjectScanCandidates | null>;
  onRefreshBranches: (
    path: string,
    options?: { silentSuccess?: boolean }
  ) => Promise<{ branches: Branch[]; currentBranch: string } | null>;
}

interface EditRepositoryDialogContentProps
  extends Omit<EditRepositoryDialogProps, "repository"> {
  repository: Repository;
}

const NO_PROVIDER_VALUE = "__none__";
const MANUAL_INPUT_VALUE = "__manual__";
const NO_PROJECT_FILE_VALUE = "__none__";
const DEFAULT_BRANCH_VALUE = "master";

const resolveBranchSelection = (branches: Branch[], preferredBranch: string) => {
  const normalizedPreferred = preferredBranch.trim();

  if (
    normalizedPreferred &&
    branches.some((branch) => branch.name === normalizedPreferred)
  ) {
    return normalizedPreferred;
  }

  return DEFAULT_BRANCH_VALUE;
};

export function EditRepositoryDialog({
  repository,
  onOpenChange,
  ...contentProps
}: EditRepositoryDialogProps) {
  return (
    <Dialog
      open={Boolean(repository)}
      onOpenChange={(open) => {
        if (!open) {
          onOpenChange(false);
        }
      }}
    >
      {repository ? (
        <EditRepositoryDialogContent
          key={repository.id}
          repository={repository}
          onOpenChange={onOpenChange}
          {...contentProps}
        />
      ) : null}
    </Dialog>
  );
}

function EditRepositoryDialogContent({
  repository,
  providers,
  repoT,
  onOpenChange,
  onEditRepo,
  onDetectProvider,
  onScanProjectCandidates,
  onRefreshBranches,
}: EditRepositoryDialogContentProps) {
  const initialBranch = repository.currentBranch?.trim() || DEFAULT_BRANCH_VALUE;
  const initialProviderId = repository.providerId?.trim() || "";
  const [editName, setEditName] = useState(() => repository.name);
  const [editPath, setEditPath] = useState(() => repository.path);
  const [editProjectFile, setEditProjectFile] = useState(
    () => repository.projectFile || ""
  );
  const [editBranches, setEditBranches] = useState(() => repository.branches);
  const [editCurrentBranch, setEditCurrentBranch] = useState(() => initialBranch);
  const [editProviderId, setEditProviderId] = useState(
    () => initialProviderId || NO_PROVIDER_VALUE
  );
  const [isSavingRepo, setIsSavingRepo] = useState(false);
  const [isDetectingProvider, setIsDetectingProvider] = useState(false);
  const [isRefreshingBranches, setIsRefreshingBranches] = useState(false);
  const [projectScan, setProjectScan] = useState<ProjectScanCandidates | null>(null);
  const [projectScanResolvedPath, setProjectScanResolvedPath] = useState<string | null>(null);
  const [isScanningProjectFiles, setIsScanningProjectFiles] = useState(false);
  const [isProjectScanPending, setIsProjectScanPending] = useState(false);
  const [isProjectFileManual, setIsProjectFileManual] = useState(
    Boolean(repository.projectFile?.trim())
  );
  const editProjectFileRef = useRef(repository.projectFile || "");
  const projectScanRequestIdRef = useRef(0);
  const shouldAutoDetectProviderRef = useRef(!initialProviderId);
  const shouldAutoRefreshBranchesRef = useRef(true);
  const invalidateProjectScanRequest = useCallback(() => {
    projectScanRequestIdRef.current += 1;
  }, []);

  const providerOptions = useMemo(() => {
    const uniqueOptions = Array.from(
      new Map(providers.map((provider) => [provider.id, provider] as const)).values()
    );

    if (
      editProviderId &&
      editProviderId !== NO_PROVIDER_VALUE &&
      !uniqueOptions.some((provider) => provider.id === editProviderId)
    ) {
      uniqueOptions.unshift({
        id: editProviderId,
        displayName: editProviderId,
        label: editProviderId,
      });
    }

    return uniqueOptions;
  }, [editProviderId, providers]);

  const branchOptions = useMemo(() => {
    const branchNames = new Set<string>();
    for (const branch of editBranches) {
      const branchName = branch.name.trim();
      if (branchName) {
        branchNames.add(branchName);
      }
    }

    const options = Array.from(branchNames);

    if (editCurrentBranch && !options.includes(editCurrentBranch)) {
      options.unshift(editCurrentBranch);
    }

    return options;
  }, [editBranches, editCurrentBranch]);

  const projectFileOptions = useMemo(
    () => projectScan?.projectFiles ?? [],
    [projectScan]
  );
  const projectFileOptionRoot = projectScan?.rootPath || editPath;
  const selectedProviderOption = useMemo(
    () => providerOptions.find((provider) => provider.id === editProviderId) ?? null,
    [editProviderId, providerOptions]
  );
  const selectedProviderRequiresProjectBinding =
    selectedProviderOption?.requiresProjectBinding ?? false;

  const requiresProjectBinding = useMemo(
    () =>
      repositoryRequiresProjectBinding({
        requiresProjectBinding: selectedProviderRequiresProjectBinding,
        candidates: projectScan,
        projectFile: editProjectFile,
      }),
    [editProjectFile, projectScan, selectedProviderRequiresProjectBinding]
  );
  const isProjectBindingPending = useMemo(
    () =>
      repositoryProjectBindingPending({
        requiresProjectBinding: selectedProviderRequiresProjectBinding,
        path: editPath,
        scanResolvedPath: projectScanResolvedPath,
        isScanning: isProjectScanPending,
      }),
    [
      editPath,
      isProjectScanPending,
      projectScanResolvedPath,
      selectedProviderRequiresProjectBinding,
    ]
  );

  useEffect(() => {
    editProjectFileRef.current = editProjectFile;
  }, [editProjectFile]);

  const runProjectCandidateScan = useCallback(
    async (path: string): Promise<ProjectScanCandidates | null> => {
      const nextPath = path.trim();
      if (!nextPath) {
        projectScanRequestIdRef.current += 1;
        setProjectScan(null);
        setProjectScanResolvedPath(null);
        setIsProjectFileManual(true);
        setIsProjectScanPending(false);
        return null;
      }

      const requestId = projectScanRequestIdRef.current + 1;
      projectScanRequestIdRef.current = requestId;
      setIsScanningProjectFiles(true);
      setIsProjectScanPending(true);

      try {
        const candidates = await onScanProjectCandidates(nextPath);
        if (projectScanRequestIdRef.current !== requestId) {
          return candidates;
        }

        setProjectScanResolvedPath(nextPath);
        if (!candidates) {
          setProjectScan(null);
          return null;
        }

        setProjectScan(candidates);
        const resolution = reconcileProjectBinding(
          editProjectFileRef.current,
          candidates
        );
        setEditProjectFile(resolution.nextProjectFile);
        setIsProjectFileManual(resolution.isManualInput);
        return candidates;
      } finally {
        if (projectScanRequestIdRef.current === requestId) {
          setIsScanningProjectFiles(false);
          setIsProjectScanPending(false);
        }
      }
    },
    [onScanProjectCandidates]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void runProjectCandidateScan(editPath);
    }, 250);

    return () => {
      window.clearTimeout(timer);
      invalidateProjectScanRequest();
    };
  }, [editPath, invalidateProjectScanRequest, runProjectCandidateScan]);

  useEffect(() => {
    if (!shouldAutoDetectProviderRef.current) {
      return;
    }

    if (editProviderId !== NO_PROVIDER_VALUE) {
      shouldAutoDetectProviderRef.current = false;
      return;
    }

    const detectPath = editPath.trim();
    if (!detectPath) {
      shouldAutoDetectProviderRef.current = false;
      return;
    }

    let cancelled = false;

    const detect = async () => {
      setIsDetectingProvider(true);
      try {
        const providerId = await onDetectProvider(detectPath, { silentSuccess: true });
        if (!cancelled && providerId) {
          setEditProviderId(providerId);
        }
      } finally {
        if (!cancelled) {
          setIsDetectingProvider(false);
          shouldAutoDetectProviderRef.current = false;
        }
      }
    };

    void detect();

    return () => {
      cancelled = true;
    };
  }, [
    editPath,
    editProviderId,
    onDetectProvider,
  ]);

  useEffect(() => {
    if (!shouldAutoRefreshBranchesRef.current) {
      return;
    }

    const refreshPath = editPath.trim();
    if (!refreshPath) {
      shouldAutoRefreshBranchesRef.current = false;
      return;
    }

    const savedBranch = repository.currentBranch?.trim() || "";
    let cancelled = false;

    const refresh = async () => {
      setIsRefreshingBranches(true);
      try {
        const refreshed = await onRefreshBranches(refreshPath, { silentSuccess: true });

        if (!cancelled && refreshed) {
          const nextCurrentBranch = resolveBranchSelection(
            refreshed.branches,
            savedBranch
          );

          setEditBranches(refreshed.branches);
          setEditCurrentBranch(nextCurrentBranch);
        }
      } finally {
        if (!cancelled) {
          setIsRefreshingBranches(false);
          shouldAutoRefreshBranchesRef.current = false;
        }
      }
    };

    void refresh();

    return () => {
      cancelled = true;
    };
  }, [
    editPath,
    onRefreshBranches,
    repository.currentBranch,
  ]);

  const handleDetectProvider = useCallback(async () => {
    const detectPath = editPath.trim();

    shouldAutoDetectProviderRef.current = false;
    setIsDetectingProvider(true);
    try {
      const providerId = await onDetectProvider(detectPath);
      if (providerId) {
        setEditProviderId(providerId);
      }
    } finally {
      setIsDetectingProvider(false);
    }
  }, [editPath, onDetectProvider]);

  const handleScanProjectFiles = useCallback(async () => {
    const scanPath = editPath.trim();
    if (!scanPath) {
      return;
    }

    await runProjectCandidateScan(scanPath);
  }, [editPath, runProjectCandidateScan]);

  const handleRefreshBranches = useCallback(async () => {
    const refreshPath = editPath.trim();

    shouldAutoRefreshBranchesRef.current = false;
    setIsRefreshingBranches(true);
    try {
      const refreshed = await onRefreshBranches(refreshPath);

      if (!refreshed) {
        return;
      }

      const preferredBranch =
        editCurrentBranch.trim() || repository.currentBranch;
      const nextCurrentBranch = resolveBranchSelection(
        refreshed.branches,
        preferredBranch
      );

      setEditBranches(refreshed.branches);
      setEditCurrentBranch(nextCurrentBranch);
    } finally {
      setIsRefreshingBranches(false);
    }
  }, [editCurrentBranch, editPath, onRefreshBranches, repository.currentBranch]);

  const handleBrowsePath = useCallback(async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: repoT.repositoryPath || "选择 Project Root",
      });
      if (selected) {
        setEditPath(selected as string);
      }
    } catch (err) {
      console.error("选择项目路径失败:", err);
    }
  }, [repoT.repositoryPath]);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const nextName = editName.trim();
      const nextPath = editPath.trim();
      const nextProjectFile = editProjectFile.trim();
      const nextCurrentBranch = editCurrentBranch.trim();
      const nextProviderId = editProviderId.trim();
      const normalizedProviderId =
        nextProviderId === NO_PROVIDER_VALUE ? "" : nextProviderId;
      const fallbackBranch =
        repository.currentBranch || editBranches[0]?.name || DEFAULT_BRANCH_VALUE;

      if (!nextName || !nextPath) {
        return;
      }

      let validatedCandidates = projectScan;
      if (isProjectBindingPending) {
        validatedCandidates = await runProjectCandidateScan(nextPath);
      }

      const resolvedProjectFile = validatedCandidates
        ? reconcileProjectBinding(nextProjectFile, validatedCandidates)
            .nextProjectFile
        : nextProjectFile;
      const bindingRequired = repositoryRequiresProjectBinding({
        requiresProjectBinding: selectedProviderRequiresProjectBinding,
        candidates: validatedCandidates,
        projectFile: resolvedProjectFile,
      });

      if (bindingRequired) {
        toast.error(repoT.projectFileBindingRequired || "请先绑定 Project File", {
          description:
            repoT.projectFileBindingRequiredDesc ||
            "当前仓库包含多个项目文件，必须显式选择一个 Project File 才能继续。",
        });
        return;
      }

      setIsSavingRepo(true);
      try {
        const updated = await onEditRepo({
          ...repository,
          name: nextName,
          path: nextPath,
          branches: editBranches,
          projectFile: resolvedProjectFile || undefined,
          currentBranch: nextCurrentBranch || fallbackBranch,
          providerId: normalizedProviderId || undefined,
        });

        if (updated) {
          onOpenChange(false);
        }
      } finally {
        setIsSavingRepo(false);
      }
    },
    [
      editCurrentBranch,
      editName,
      editPath,
      editProjectFile,
      editProviderId,
      editBranches,
      isProjectBindingPending,
      onEditRepo,
      onOpenChange,
      repoT,
      projectScan,
      repository,
      runProjectCandidateScan,
      selectedProviderRequiresProjectBinding,
    ]
  );

  const isEditNameEmpty = editName.trim().length === 0;
  const isEditPathEmpty = editPath.trim().length === 0;

  return (
    <AppDialogShell
        size="workspace"
        bodyPadding="none"
        bodyScrollable={false}
        bodyInnerClassName="min-h-0 flex-1"
        title={
          <div className="flex items-center gap-1.5">
            <span>{repoT.editRepository || "编辑项目信息"}</span>
            <div className="group relative inline-block">
              <HelpCircle className="size-3.5 text-muted-foreground/60 cursor-help hover:text-foreground transition-colors" />
              <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block w-64 p-2 bg-[var(--glass-panel-bg)] backdrop-blur-xl text-popover-foreground text-xs rounded-xl shadow-[var(--glass-shadow-lg)] border border-[var(--glass-border)] z-10 leading-4 font-normal">
                {repoT.editRepositoryHint || "修改仓库基础信息后会立即刷新左栏展示与关联状态。"}
              </div>
            </div>
          </div>
        }
        description={
          repoT.editRepositoryDescription ||
          "可编辑仓库名称、Project Root、Project File 与当前分支信息。"
        }
        icon={<FolderGit2 className="size-4" />}
        footer={
          <>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:ml-auto">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isSavingRepo || isDetectingProvider || isRefreshingBranches}
              >
                {repoT.cancel || "取消"}
              </Button>
              <Button
                type="submit"
                form="edit-repository-form"
                disabled={
                  isSavingRepo ||
                  isDetectingProvider ||
                  isRefreshingBranches ||
                  isProjectBindingPending ||
                  requiresProjectBinding ||
                  isEditNameEmpty ||
                  isEditPathEmpty
                }
              >
                {isSavingRepo ? repoT.saving || "保存中..." : repoT.save || "保存"}
              </Button>
            </div>
          </>
        }
      >
        <div className="grid flex-1 min-h-0 gap-5 p-5 sm:grid-cols-[240px_1fr] sm:p-6">
          {/* Left Panel: Repo Info Card */}
          <aside className="glass-card flex flex-col items-center justify-between rounded-2xl p-5 text-center bg-gradient-to-b from-primary/[0.03] to-transparent border border-[var(--glass-border-subtle)] min-h-0 overflow-y-auto glass-scrollbar">
            <div className="flex flex-col items-center w-full">
              {/* Glowing Icon Wrapper */}
              <div className="flex size-16 items-center justify-center rounded-2xl bg-gradient-to-tr from-primary/20 to-primary/5 text-primary shadow-[0_8px_30px_rgba(59,130,246,0.12)] ring-1 ring-primary/20">
                <FolderGit2 className="size-8" />
              </div>
              
              <h3 className="mt-4 text-base font-semibold tracking-tight truncate max-w-full text-foreground flex items-center justify-center gap-1.5 w-full">
                <span className="truncate">
                  {editName || repoT.unnamedRepository || "未命名仓库"}
                </span>
                <div className="group relative inline-block shrink-0">
                  <HelpCircle className="size-3.5 text-muted-foreground/60 cursor-help hover:text-foreground transition-colors" />
                  <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block w-48 p-2 bg-[var(--glass-panel-bg)] backdrop-blur-xl text-popover-foreground text-xs rounded-xl shadow-[var(--glass-shadow-lg)] border border-[var(--glass-border)] z-10 leading-4 font-normal text-left">
                    {repoT.repositoryBindingHint || "请确保仓库路径和项目绑定正确，这会直接影响后续的自动化发布配置构建。"}
                  </div>
                </div>
              </h3>
              
              <p className="mt-2 text-xs text-muted-foreground break-all px-2.5 py-1.5 rounded-xl bg-black/5 dark:bg-white/5 border border-[var(--glass-border-subtle)] font-mono max-w-full">
                {editPath || repoT.unselectedPath || "未选择路径"}
              </p>
 
              {/* Status Stats List */}
              <div className="w-full mt-6 space-y-2 text-left">
                <div className="flex items-center justify-between rounded-xl border border-[var(--glass-border-subtle)] bg-background/40 px-3.5 py-2.5">
                  <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <GitBranch className="size-3.5 text-muted-foreground" />
                    {repoT.branchCount || "分支数量"}
                  </span>
                  <span className="text-xs font-semibold font-mono text-foreground bg-primary/10 px-2 py-0.5 rounded-full">
                    {branchOptions.length}
                  </span>
                </div>
 
                <div className="flex items-center justify-between rounded-xl border border-[var(--glass-border-subtle)] bg-background/40 px-3.5 py-2.5">
                  <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Activity className="size-3.5 text-muted-foreground" />
                    {repoT.bindingStatus || "绑定状态"}
                  </span>
                  <span className={cn(
                    "text-xs font-semibold px-2 py-0.5 rounded-full",
                    editProviderId && editProviderId !== NO_PROVIDER_VALUE
                      ? "text-emerald-500 bg-emerald-500/10"
                      : "text-amber-500 bg-amber-500/10"
                  )}>
                    {editProviderId && editProviderId !== NO_PROVIDER_VALUE
                      ? repoT.bound || "已绑定"
                      : repoT.unbound || "未绑定"}
                  </span>
                </div>
 
                {editProviderId && editProviderId !== NO_PROVIDER_VALUE ? (
                  <div className="flex items-center justify-between rounded-xl border border-[var(--glass-border-subtle)] bg-background/40 px-3.5 py-2.5">
                    <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Info className="size-3.5 text-muted-foreground" />
                      {repoT.currentProvider || "当前服务"}
                    </span>
                    <span className="text-xs font-semibold text-foreground font-mono truncate max-w-[120px]">
                      {selectedProviderOption?.label || selectedProviderOption?.displayName || editProviderId}
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
          </aside>
 
          {/* Right Panel: Form Fields */}
          <form id="edit-repository-form" className="flex flex-col min-h-0 overflow-y-auto glass-scrollbar gap-y-4 pb-1 pr-1" onSubmit={handleSubmit}>
            {/* Card 1: Basic Config */}
            <AppDialogInset className="space-y-4 p-5 bg-gradient-to-br from-background/30 to-background/5 border border-[var(--glass-border-subtle)]">
              <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-primary flex items-center gap-1.5 mb-1">
                <span className="size-1.5 rounded-full bg-primary" />
                {repoT.basicConfig || "基础配置"}
              </h4>

              <div className="space-y-4">
                {/* 仓库名称 */}
                <div className="space-y-1.5">
                  <Label htmlFor="repo-edit-name" className="text-xs font-medium text-foreground/80">
                    {repoT.repositoryName || "仓库名称"}
                  </Label>
                  <Input
                    id="repo-edit-name"
                    value={editName}
                    onChange={(event) => setEditName(event.target.value)}
                    placeholder={repoT.repositoryNamePlaceholder || "请输入仓库名称"}
                    className="h-9 text-sm focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all duration-300"
                  />
                  {isEditNameEmpty ? (
                    <p className="text-[11px] text-destructive">
                      {repoT.repositoryNameRequired || "请输入仓库名称"}
                    </p>
                  ) : null}
                </div>

                {/* Project Root */}
                <div className="space-y-1.5">
                  <Label htmlFor="repo-edit-path" className="text-xs font-medium text-foreground/80">
                    {repoT.repositoryPath || "Project Root"}
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="repo-edit-path"
                      value={editPath}
                      onChange={(event) => setEditPath(event.target.value)}
                      placeholder={repoT.repositoryPathPlaceholder || "请输入项目根目录路径"}
                      className="h-9 flex-1 text-sm focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all duration-300"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-9 shrink-0 hover:bg-primary/5 hover:text-primary transition-colors duration-300"
                      onClick={handleBrowsePath}
                      title={repoT.browseFolder || "浏览文件夹"}
                    >
                      <FolderGit2 className="size-4" />
                    </Button>
                  </div>
                  {isEditPathEmpty ? (
                    <p className="text-[11px] text-destructive">
                      {repoT.repositoryPathRequired || "请输入项目根目录路径"}
                    </p>
                  ) : null}
                </div>
              </div>
            </AppDialogInset>

            {/* Card 2: Project File & Provider / Git */}
            <AppDialogInset className="space-y-4 p-5 bg-gradient-to-br from-background/30 to-background/5 border border-[var(--glass-border-subtle)]">
              <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-primary flex items-center gap-1.5 mb-1">
                <span className="size-1.5 rounded-full bg-primary" />
                {repoT.projectBranchSection || "项目定位与分支"}
              </h4>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* Project File */}
                <div className="space-y-1.5">
                  <Label htmlFor="repo-edit-project-file" className="text-xs font-medium text-foreground/80">
                    {repoT.projectFile || "Project File"}
                  </Label>
                  <div className="flex items-center gap-2">
                    {isProjectFileManual ? (
                      <Input
                        id="repo-edit-project-file"
                        className="h-9 flex-1 text-sm focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
                        value={editProjectFile}
                        onChange={(event) => setEditProjectFile(event.target.value)}
                        placeholder={repoT.projectFilePlaceholder || "可选项目文件"}
                      />
                    ) : (
                      <Select
                        value={editProjectFile || NO_PROJECT_FILE_VALUE}
                        onValueChange={(value) => {
                          if (value === MANUAL_INPUT_VALUE) {
                            setIsProjectFileManual(true);
                            return;
                          }
                          setEditProjectFile(value === NO_PROJECT_FILE_VALUE ? "" : value);
                        }}
                        disabled={isScanningProjectFiles}
                      >
                        <SelectTrigger id="repo-edit-project-file" className="h-9 flex-1 text-sm">
                          <SelectValue
                            placeholder={
                              isScanningProjectFiles
                                ? repoT.scanningProjectFiles || "扫描中..."
                                : repoT.projectFilePlaceholder || "可选项目文件"
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_PROJECT_FILE_VALUE}>
                            {repoT.projectFileNone || "未设置"}
                          </SelectItem>
                          {projectFileOptions.map((filePath) => (
                            <SelectItem key={filePath} value={filePath}>
                              {getPathRelativeToRoot(filePath, projectFileOptionRoot)}
                            </SelectItem>
                          ))}
                          <SelectItem value={MANUAL_INPUT_VALUE}>
                            {repoT.projectFileManualInput || "手动输入..."}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-9 shrink-0 hover:bg-primary/5 hover:text-primary transition-colors"
                      onClick={() => {
                        if (isProjectFileManual && projectFileOptions.length > 0) {
                          setIsProjectFileManual(false);
                        } else {
                          void handleScanProjectFiles();
                        }
                      }}
                      title={repoT.scanProjectFiles || "扫描项目文件"}
                      disabled={isSavingRepo || isScanningProjectFiles || !editPath.trim()}
                    >
                      <FileSearch
                        className={cn("size-4", isScanningProjectFiles && "animate-spin")}
                      />
                    </Button>
                  </div>
                  {isProjectBindingPending ? (
                    <p className="text-[11px] text-muted-foreground animate-pulse">
                      {repoT.projectFileScanningPending || "正在扫描项目文件..."}
                    </p>
                  ) : null}
                  {requiresProjectBinding ? (
                    <p className="text-[11px] text-destructive">
                      {repoT.projectFileBindingRequiredInline || "请先选择一个 Project File。"}
                    </p>
                  ) : null}
                </div>

                {/* Provider */}
                <div className="space-y-1.5">
                  <Label htmlFor="repo-edit-provider" className="text-xs font-medium text-foreground/80">
                    {repoT.provider || "Provider"}
                  </Label>
                  <div className="flex items-center gap-2">
                    <Select
                      value={editProviderId}
                      onValueChange={(value) => {
                        shouldAutoDetectProviderRef.current = false;
                        setEditProviderId(value);
                      }}
                      disabled={isDetectingProvider}
                    >
                      <SelectTrigger id="repo-edit-provider" className="h-9 flex-1 text-sm">
                        <SelectValue placeholder={repoT.providerPlaceholder || "选择 Provider"} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_PROVIDER_VALUE}>
                          {repoT.providerUnspecified || "未设置"}
                        </SelectItem>
                        {providerOptions.map((provider) => (
                          <SelectItem key={provider.id} value={provider.id}>
                            {provider.label || provider.displayName || provider.id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-9 shrink-0 hover:bg-primary/5 hover:text-primary transition-colors"
                      onClick={() => {
                        void handleDetectProvider();
                      }}
                      title={repoT.detectProvider || "自动检测 Provider"}
                      disabled={isSavingRepo || isDetectingProvider || isRefreshingBranches}
                    >
                      <RefreshCw className={cn("size-4", isDetectingProvider && "animate-spin")} />
                    </Button>
                  </div>
                </div>
              </div>

              {/* 当前分支 */}
              <div className="space-y-1.5 pt-2 border-t border-[var(--glass-border-subtle)]">
                <Label htmlFor="repo-edit-branch" className="text-xs font-medium text-foreground/80">
                  {repoT.currentBranch || "当前分支"}
                </Label>
                <div className="flex items-center gap-2">
                  <Select
                    value={editCurrentBranch}
                    onValueChange={setEditCurrentBranch}
                    disabled={branchOptions.length === 0 || isRefreshingBranches}
                  >
                    <SelectTrigger id="repo-edit-branch" className="h-9 flex-1 text-sm">
                      <SelectValue placeholder={repoT.currentBranchPlaceholder || "请选择分支"} />
                    </SelectTrigger>
                    <SelectContent>
                      {branchOptions.map((branchName) => (
                        <SelectItem key={branchName} value={branchName}>
                          {branchName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-9 shrink-0 hover:bg-primary/5 hover:text-primary transition-colors"
                    onClick={() => {
                      void handleRefreshBranches();
                    }}
                    title={repoT.refreshBranches || "刷新分支"}
                    disabled={isSavingRepo || isDetectingProvider || isRefreshingBranches}
                  >
                    <RefreshCw className={cn("size-4", isRefreshingBranches && "animate-spin")} />
                  </Button>
                </div>
              </div>
            </AppDialogInset>
          </form>
        </div>
    </AppDialogShell>
  );
}
