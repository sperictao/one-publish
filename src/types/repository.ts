// Repository and branch types

import type { PublishConfigStore, ConfigProfile } from "@/lib/store";

export interface RepoPublishConfig {
  selectedPreset: string;
  isCustomMode: boolean;
  customConfig: PublishConfigStore;
  profiles: ConfigProfile[];
}

export interface Repository {
  id: string;
  name: string;
  path: string;
  projectFile?: string;
  currentBranch: string;
  branches: Branch[];
  isMain?: boolean;
  providerId?: string;
  publishConfig: RepoPublishConfig;
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
