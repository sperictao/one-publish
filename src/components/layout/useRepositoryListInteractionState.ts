import { useMemo } from "react";
import { useListInteractionState } from "./useListInteractionState";

interface UseRepositoryListInteractionStateOptions {
  filteredRepoIds: string[];
  selectedRepoId: string | null;
}

export interface RepositoryListInteractionState {
  visualTargetRepoId: string | null;
  handleRowMouseEnter: (repoId: string) => void;
  handleRowFocus: (repoId: string) => void;
  handleRowBlur: (repoId: string) => void;
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
      visualTargetRepoId: interaction.visualTargetItemId,
      handleRowMouseEnter: interaction.handleRowMouseEnter,
      handleRowFocus: interaction.handleRowFocus,
      handleRowBlur: interaction.handleRowBlur,
      handleListPointerEnter: interaction.handleListPointerEnter,
      handleListPointerLeave: interaction.handleListPointerLeave,
      handleMenuOpenChange: interaction.handleMenuOpenChange,
      isMenuOpenForRepo: interaction.isMenuOpenForItem,
    }),
    [interaction]
  );
}
