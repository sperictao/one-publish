import { useMemo } from "react";
import { useListInteractionState } from "./useListInteractionState";

interface UseRepositoryListInteractionStateOptions {
  filteredRepoIds: string[];
  selectedRepoId: string | null;
}

export interface RepositoryListInteractionState {
  hoveredRepoId: string | null;
  focusedRepoId: string | null;
  activeMenuRepoId: string | null;
  visualTargetRepoId: string | null;
  freezeFloating: boolean;
  handleRowMouseEnter: (repoId: string) => void;
  handleRowFocus: (repoId: string) => void;
  handleRowBlur: (repoId: string) => void;
  handlePointerRepoChange: (repoId: string | null) => void;
  handleListPointerEnter: () => void;
  handleListPointerLeave: () => void;
  handleMenuOpenChange: (repoId: string, open: boolean) => void;
  isMenuOpenForRepo: (repoId: string) => boolean;
}

export function useRepositoryListInteractionState({
  filteredRepoIds,
  selectedRepoId,
}: UseRepositoryListInteractionStateOptions): RepositoryListInteractionState {
  const interaction = useListInteractionState({
    filteredItemIds: filteredRepoIds,
    selectedItemId: selectedRepoId,
  });

  return useMemo(
    () => ({
      hoveredRepoId: interaction.hoveredItemId,
      focusedRepoId: interaction.focusedItemId,
      activeMenuRepoId: interaction.activeMenuItemId,
      visualTargetRepoId: interaction.visualTargetItemId,
      freezeFloating: interaction.freezeFloating,
      handleRowMouseEnter: interaction.handleRowMouseEnter,
      handleRowFocus: interaction.handleRowFocus,
      handleRowBlur: interaction.handleRowBlur,
      handlePointerRepoChange: interaction.handlePointerItemChange,
      handleListPointerEnter: interaction.handleListPointerEnter,
      handleListPointerLeave: interaction.handleListPointerLeave,
      handleMenuOpenChange: interaction.handleMenuOpenChange,
      isMenuOpenForRepo: interaction.isMenuOpenForItem,
    }),
    [interaction]
  );
}
