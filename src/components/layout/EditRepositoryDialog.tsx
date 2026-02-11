import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileSearch, RefreshCw } from "lucide-react";
import type { Branch, Repository } from "@/types/repository";

interface ProviderOption {
  id: string;
  displayName: string;
  label?: string;
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
  onScanProjectFiles: (path: string) => Promise<string[]>;
  onRefreshBranches: (
    path: string,
    options?: { silentSuccess?: boolean }
  ) => Promise<{ branches: Branch[]; currentBranch: string } | null>;
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
  providers,
  repoT,
  onOpenChange,
  onEditRepo,
  onDetectProvider,
  onScanProjectFiles,
  onRefreshBranches,
}: EditRepositoryDialogProps) {
  const [editingRepo, setEditingRepo] = useState<Repository | null>(null);
  const [editName, setEditName] = useState("");
  const [editPath, setEditPath] = useState("");
  const [editProjectFile, setEditProjectFile] = useState("");
  const [editCurrentBranch, setEditCurrentBranch] = useState("");
  const [editProviderId, setEditProviderId] = useState("");
  const [isSavingRepo, setIsSavingRepo] = useState(false);
  const [isDetectingProvider, setIsDetectingProvider] = useState(false);
  const [isRefreshingBranches, setIsRefreshingBranches] = useState(false);
  const [shouldAutoDetectProvider, setShouldAutoDetectProvider] = useState(false);
  const [shouldAutoRefreshBranches, setShouldAutoRefreshBranches] = useState(false);
  const [projectFileOptions, setProjectFileOptions] = useState<string[]>([]);
  const [isScanningProjectFiles, setIsScanningProjectFiles] = useState(false);
  const [isProjectFileManual, setIsProjectFileManual] = useState(false);

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
    if (!editingRepo) {
      return [] as string[];
    }

    const options = Array.from(
      new Set(
        editingRepo.branches
          .map((branch) => branch.name.trim())
          .filter((branchName) => branchName.length > 0)
      )
    );

    if (editCurrentBranch && !options.includes(editCurrentBranch)) {
      options.unshift(editCurrentBranch);
    }

    return options;
  }, [editCurrentBranch, editingRepo]);

  const resetForm = useCallback(() => {
    setEditingRepo(null);
    setEditName("");
    setEditPath("");
    setEditProjectFile("");
    setEditCurrentBranch("");
    setEditProviderId("");
    setIsSavingRepo(false);
    setIsDetectingProvider(false);
    setIsRefreshingBranches(false);
    setShouldAutoDetectProvider(false);
    setShouldAutoRefreshBranches(false);
    setProjectFileOptions([]);
    setIsScanningProjectFiles(false);
    setIsProjectFileManual(false);
  }, []);

  useEffect(() => {
    if (!repository) {
      resetForm();
      return;
    }

    const initialBranch = repository.currentBranch?.trim() || DEFAULT_BRANCH_VALUE;
    const initialProviderId = repository.providerId?.trim() || "";

    setEditingRepo(repository);
    setEditName(repository.name);
    setEditPath(repository.path);
    setEditProjectFile(repository.projectFile || "");
    setEditCurrentBranch(initialBranch);
    setEditProviderId(initialProviderId || NO_PROVIDER_VALUE);
    setIsSavingRepo(false);
    setIsDetectingProvider(false);
    setIsRefreshingBranches(false);
    setShouldAutoDetectProvider(!initialProviderId);
    setShouldAutoRefreshBranches(true);
    setProjectFileOptions([]);
    setIsScanningProjectFiles(false);
    setIsProjectFileManual(false);

    if (!repository.path.trim()) {
      setIsProjectFileManual(true);
      return;
    }

    let cancelled = false;

    setIsScanningProjectFiles(true);
    void onScanProjectFiles(repository.path.trim())
      .then((files) => {
        if (cancelled) {
          return;
        }

        setProjectFileOptions(files);

        const currentFile = repository.projectFile?.trim() || "";
        if (files.length === 0) {
          setIsProjectFileManual(true);
          return;
        }

        if (currentFile && !files.includes(currentFile)) {
          setIsProjectFileManual(true);
          return;
        }

        setIsProjectFileManual(false);
      })
      .finally(() => {
        if (!cancelled) {
          setIsScanningProjectFiles(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [onScanProjectFiles, repository, resetForm]);

  useEffect(() => {
    if (!editingRepo || !shouldAutoDetectProvider) {
      return;
    }

    if (editProviderId !== NO_PROVIDER_VALUE) {
      setShouldAutoDetectProvider(false);
      return;
    }

    const detectPath = editPath.trim();
    if (!detectPath) {
      setShouldAutoDetectProvider(false);
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
          setShouldAutoDetectProvider(false);
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
    editingRepo,
    onDetectProvider,
    shouldAutoDetectProvider,
  ]);

  useEffect(() => {
    if (!editingRepo || !shouldAutoRefreshBranches) {
      return;
    }

    const refreshPath = editPath.trim();
    if (!refreshPath) {
      setShouldAutoRefreshBranches(false);
      return;
    }

    const savedBranch = editingRepo.currentBranch?.trim() || "";
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

          setEditingRepo((prev) => {
            if (!prev) {
              return prev;
            }

            return {
              ...prev,
              branches: refreshed.branches,
              currentBranch: nextCurrentBranch,
            };
          });
          setEditCurrentBranch(nextCurrentBranch);
        }
      } finally {
        if (!cancelled) {
          setIsRefreshingBranches(false);
          setShouldAutoRefreshBranches(false);
        }
      }
    };

    void refresh();

    return () => {
      cancelled = true;
    };
  }, [editPath, editingRepo, onRefreshBranches, shouldAutoRefreshBranches]);

  const handleDetectProvider = useCallback(async () => {
    const detectPath = editPath.trim();

    setShouldAutoDetectProvider(false);
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

    setIsScanningProjectFiles(true);
    try {
      const files = await onScanProjectFiles(scanPath);
      setProjectFileOptions(files);
      if (files.length === 0) {
        setIsProjectFileManual(true);
        return;
      }

      setIsProjectFileManual(false);
      if (!editProjectFile.trim()) {
        setEditProjectFile(files[0]);
      }
    } finally {
      setIsScanningProjectFiles(false);
    }
  }, [editPath, editProjectFile, onScanProjectFiles]);

  const handleRefreshBranches = useCallback(async () => {
    if (!editingRepo) {
      return;
    }

    const refreshPath = editPath.trim();

    setShouldAutoRefreshBranches(false);
    setIsRefreshingBranches(true);
    try {
      const refreshed = await onRefreshBranches(refreshPath);

      if (!refreshed) {
        return;
      }

      const preferredBranch = editCurrentBranch.trim() || editingRepo.currentBranch;
      const nextCurrentBranch = resolveBranchSelection(
        refreshed.branches,
        preferredBranch
      );

      setEditingRepo((prev) => {
        if (!prev) {
          return prev;
        }

        return {
          ...prev,
          branches: refreshed.branches,
          currentBranch: nextCurrentBranch,
        };
      });

      setEditCurrentBranch(nextCurrentBranch);
    } finally {
      setIsRefreshingBranches(false);
    }
  }, [editCurrentBranch, editPath, editingRepo, onRefreshBranches]);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!editingRepo) {
        return;
      }

      const nextName = editName.trim();
      const nextPath = editPath.trim();
      const nextProjectFile = editProjectFile.trim();
      const nextCurrentBranch = editCurrentBranch.trim();
      const nextProviderId = editProviderId.trim();
      const normalizedProviderId =
        nextProviderId === NO_PROVIDER_VALUE ? "" : nextProviderId;
      const fallbackBranch =
        editingRepo.currentBranch || editingRepo.branches[0]?.name || DEFAULT_BRANCH_VALUE;

      if (!nextName || !nextPath) {
        return;
      }

      setIsSavingRepo(true);
      try {
        const updated = await onEditRepo({
          ...editingRepo,
          name: nextName,
          path: nextPath,
          projectFile: nextProjectFile || undefined,
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
      editingRepo,
      onEditRepo,
      onOpenChange,
    ]
  );

  const isEditNameEmpty = editName.trim().length === 0;
  const isEditPathEmpty = editPath.trim().length === 0;

  return (
    <Dialog
      open={Boolean(repository)}
      onOpenChange={(open) => {
        if (!open) {
          onOpenChange(false);
        }
      }}
    >
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{repoT.editRepository || "编辑项目信息"}</DialogTitle>
          <DialogDescription>
            {repoT.editRepositoryDescription ||
              "可编辑仓库名称、Project Root、Project File 与当前分支信息。"}
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="repo-edit-name">{repoT.repositoryName || "仓库名称"}</Label>
            <Input
              id="repo-edit-name"
              value={editName}
              onChange={(event) => setEditName(event.target.value)}
              placeholder={repoT.repositoryNamePlaceholder || "请输入仓库名称"}
            />
            {isEditNameEmpty && (
              <p className="text-xs text-destructive">
                {repoT.repositoryNameRequired || "请输入仓库名称"}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="repo-edit-path">{repoT.repositoryPath || "Project Root"}</Label>
            <Input
              id="repo-edit-path"
              value={editPath}
              onChange={(event) => setEditPath(event.target.value)}
              placeholder={repoT.repositoryPathPlaceholder || "请输入项目根目录路径"}
            />
            {isEditPathEmpty && (
              <p className="text-xs text-destructive">
                {repoT.repositoryPathRequired || "请输入项目根目录路径"}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="repo-edit-project-file">{repoT.projectFile || "Project File"}</Label>
            <div className="flex items-center gap-2">
              {isProjectFileManual ? (
                <Input
                  id="repo-edit-project-file"
                  className="flex-1"
                  value={editProjectFile}
                  onChange={(event) => setEditProjectFile(event.target.value)}
                  placeholder={repoT.projectFilePlaceholder || "可选：请输入项目文件路径"}
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
                  <SelectTrigger id="repo-edit-project-file" className="flex-1">
                    <SelectValue
                      placeholder={
                        isScanningProjectFiles
                          ? repoT.scanningProjectFiles || "扫描中..."
                          : repoT.projectFilePlaceholder || "可选：请输入项目文件路径"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_PROJECT_FILE_VALUE}>
                      {repoT.projectFileNone || "未设置"}
                    </SelectItem>
                    {projectFileOptions.map((filePath) => (
                      <SelectItem key={filePath} value={filePath}>
                        {filePath.split("/").pop() || filePath}
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
                className="h-9 w-9"
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
                  className={cn("h-4 w-4", isScanningProjectFiles && "animate-spin")}
                />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {repoT.projectFileScanHint || "可从自动扫描结果中选择，或切换到手动输入。"}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="repo-edit-provider">{repoT.provider || "Provider"}</Label>
            <div className="flex items-center gap-2">
              <Select
                value={editProviderId}
                onValueChange={(value) => {
                  setShouldAutoDetectProvider(false);
                  setEditProviderId(value);
                }}
                disabled={isDetectingProvider}
              >
                <SelectTrigger id="repo-edit-provider" className="flex-1">
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
                className="h-9 w-9"
                onClick={() => {
                  void handleDetectProvider();
                }}
                title={repoT.detectProvider || "自动检测 Provider"}
                disabled={isSavingRepo || isDetectingProvider || isRefreshingBranches}
              >
                <RefreshCw className={cn("h-4 w-4", isDetectingProvider && "animate-spin")} />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {repoT.providerDetectHint || "可手动填写 Provider，或点击右侧按钮自动检测。"}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="repo-edit-branch">{repoT.currentBranch || "当前分支"}</Label>
            <div className="flex items-center gap-2">
              <Select
                value={editCurrentBranch}
                onValueChange={setEditCurrentBranch}
                disabled={branchOptions.length === 0 || isRefreshingBranches}
              >
                <SelectTrigger id="repo-edit-branch" className="flex-1">
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
                className="h-9 w-9"
                onClick={() => {
                  void handleRefreshBranches();
                }}
                title={repoT.refreshBranches || "刷新分支"}
                disabled={isSavingRepo || isDetectingProvider || isRefreshingBranches}
              >
                <RefreshCw className={cn("h-4 w-4", isRefreshingBranches && "animate-spin")} />
              </Button>
            </div>
            {branchOptions.length === 0 && (
              <p className="text-xs text-muted-foreground">{repoT.noBranches || "暂无可选分支"}</p>
            )}
          </div>

          <DialogFooter>
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
              disabled={
                isSavingRepo ||
                isDetectingProvider ||
                isRefreshingBranches ||
                isEditNameEmpty ||
                isEditPathEmpty
              }
            >
              {isSavingRepo ? repoT.saving || "保存中..." : repoT.save || "保存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
