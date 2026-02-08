// Repository and branch types

export interface Repository {
  id: string;
  name: string;
  path: string;
  projectFile?: string;
  currentBranch: string;
  branches: Branch[];
  isMain?: boolean;
  providerId?: string;
}

export interface Branch {
  name: string;
  isMain: boolean;
  isCurrent: boolean;
  path: string;
  commitCount?: number;
}

export interface WorkTree {
  name: string;
  path: string;
  branch: string;
  isMain: boolean;
}

export interface AppState {
  repositories: Repository[];
  selectedRepoId: string | null;
  leftPanelCollapsed: boolean;
  middlePanelCollapsed: boolean;
}
