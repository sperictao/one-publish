import type {
  ConfigParameters,
  ConfigProfile,
} from "@/lib/store/types";

export interface TranslationMap {
  [key: string]: string | undefined;
}

export interface QuickCreateTemplateOption {
  id: string;
  name: string;
  description: string;
}

export interface LoadableProfile {
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
  isRefreshing: boolean;
  refreshProfiles: () => Promise<ConfigProfile[]>;
  saveProfile: (params: ProfileManagementSaveParams) => Promise<void>;
  deleteProfile: (profile: ConfigProfile) => Promise<void>;
  exportProfiles: (filePath: string) => Promise<void>;
  applyImportedProfiles: (profiles: ConfigProfile[]) => Promise<void>;
}

export const QUICK_CREATE_CUSTOM_TEMPLATE_ID = "custom";
export const QUICK_CREATE_PROFILE_GROUP_DEFAULT = "__default__";
export const QUICK_CREATE_PROFILE_GROUP_CUSTOM = "__custom__";
