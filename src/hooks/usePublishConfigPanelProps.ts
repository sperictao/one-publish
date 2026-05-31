import { useMemo } from "react";
import type { PublishConfigPanelProps } from "@/components/layout/PublishConfigPanel";
import type { ConfigProfile } from "@/lib/store/types";

interface UsePublishConfigPanelPropsParams {
  selectedRepoId: string | null;
  selectedPreset: string;
  isCustomMode: boolean;
  profiles: ConfigProfile[];
  isProfilesRefreshing: boolean;
  activeProfileName: string | null;
  onSelectProfile: (profile: ConfigProfile) => void;
  onCreateProfile: () => void;
  onEditProfile: (profile: ConfigProfile) => void;
  onRefreshProfiles: () => void;
  onOpenConfigDialog: () => void;
  onDeleteProfile: (name: string) => void;
  projectPublishProfiles: string[];
  isProjectProfilesRefreshing: boolean;
  projectFilePath?: string;
  projectFrameworkOptions: string[];
  onSelectProjectProfile: (profileName: string) => void;
  onCopyProjectProfileToCustom: PublishConfigPanelProps["onCopyProjectProfileToCustom"];
  recentConfigKeys: string[];
  favoriteConfigKeys: string[];
  onToggleFavoriteConfig: (configKey: string) => void;
  onRemoveRecentConfig: (configKey: string) => void;
  onReorderRecentConfigs: (configKeys: string[]) => void;
  onReorderProjectProfiles: (profileNames: string[]) => void;
  onReorderProfiles: (profiles: ConfigProfile[]) => void;
  onCollapse: () => void;
  showExpandButton: boolean;
  onExpandRepo: () => void;
}

export function usePublishConfigPanelProps(
  params: UsePublishConfigPanelPropsParams
): PublishConfigPanelProps {
  return useMemo<PublishConfigPanelProps>(
    () => ({
      selectedRepoId: params.selectedRepoId,
      selectedPreset: params.selectedPreset,
      isCustomMode: params.isCustomMode,
      profiles: params.profiles,
      isProfilesRefreshing: params.isProfilesRefreshing,
      activeProfileName: params.activeProfileName,
      onSelectProfile: params.onSelectProfile,
      onCreateProfile: params.onCreateProfile,
      onEditProfile: params.onEditProfile,
      onRefreshProfiles: params.onRefreshProfiles,
      onOpenConfigDialog: params.onOpenConfigDialog,
      onDeleteProfile: params.onDeleteProfile,
      projectPublishProfiles: params.projectPublishProfiles,
      isProjectProfilesRefreshing: params.isProjectProfilesRefreshing,
      projectFilePath: params.projectFilePath,
      projectFrameworkOptions: params.projectFrameworkOptions,
      onSelectProjectProfile: params.onSelectProjectProfile,
      onCopyProjectProfileToCustom: params.onCopyProjectProfileToCustom,
      recentConfigKeys: params.recentConfigKeys,
      favoriteConfigKeys: params.favoriteConfigKeys,
      onToggleFavoriteConfig: params.onToggleFavoriteConfig,
      onRemoveRecentConfig: params.onRemoveRecentConfig,
      onReorderRecentConfigs: params.onReorderRecentConfigs,
      onReorderProjectProfiles: params.onReorderProjectProfiles,
      onReorderProfiles: params.onReorderProfiles,
      onCollapse: params.onCollapse,
      showExpandButton: params.showExpandButton,
      onExpandRepo: params.onExpandRepo,
    }),
    [
      params.activeProfileName,
      params.favoriteConfigKeys,
      params.onCreateProfile,
      params.onOpenConfigDialog,
      params.onDeleteProfile,
      params.onReorderProfiles,
      params.onSelectProfile,
      params.onSelectProjectProfile,
      params.isCustomMode,
      params.isProfilesRefreshing,
      params.isProjectProfilesRefreshing,
      params.showExpandButton,
      params.onRefreshProfiles,
      params.onEditProfile,
      params.projectPublishProfiles,
      params.profiles,
      params.projectFrameworkOptions,
      params.projectFilePath,
      params.recentConfigKeys,
      params.onRemoveRecentConfig,
      params.onReorderProjectProfiles,
      params.onReorderRecentConfigs,
      params.selectedPreset,
      params.selectedRepoId,
      params.onCollapse,
      params.onExpandRepo,
      params.onCopyProjectProfileToCustom,
      params.onToggleFavoriteConfig,
    ]
  );
}
