import type { ImportedConfigSummary } from "@/generated/tauri-contracts";
import type { ConfigParameters, ConfigProfile } from "@/lib/store/types";

export interface TranslationMap {
  [key: string]: string | undefined;
}

export interface QuickCreateTemplateOption {
  id: string;
  name: string;
  description: string;
}

export interface LoadableProfile {
  id?: string;
  revisionId?: string;
  name: string;
  providerId?: string;
  provider_id?: string;
  parameters?: Record<string, unknown>;
}

export interface ProfileManagementSaveParams {
  name: string;
  providerId: string;
  parameters: ConfigParameters;
  profileGroup?: string;
}

export interface ProfileManagementActions {
  profiles: ConfigProfile[];
  /** 当前仓库声明的 Provider；导入预览据此标出不属于本仓库的配置。 */
  repositoryProviderId: string | null;
  isRefreshing: boolean;
  refreshProfiles: () => Promise<ConfigProfile[]>;
  saveProfile: (params: ProfileManagementSaveParams) => Promise<void>;
  deleteProfile: (profile: ConfigProfile) => Promise<void>;
  /** 返回实际写入的路径（后端可能补齐 `.json` 扩展名）。 */
  exportProfiles: (filePath: string) => Promise<string>;
  applyImportedProfiles: (
    profiles: ConfigProfile[]
  ) => Promise<ImportedConfigSummary>;
}

export const QUICK_CREATE_CUSTOM_TEMPLATE_ID = "custom";
export const QUICK_CREATE_PROFILE_GROUP_DEFAULT = "__default__";
export const QUICK_CREATE_PROFILE_GROUP_CUSTOM = "__custom__";
