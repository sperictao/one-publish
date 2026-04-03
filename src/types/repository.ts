export type {
  AppState,
  Branch,
  ConfigParameters,
  ConfigProfile,
  PublishConfigStore,
  RepoPublishConfig,
  Repository,
} from "@/lib/store";

export interface WorkTree {
  name: string;
  path: string;
  branch: string;
  isMain: boolean;
}
