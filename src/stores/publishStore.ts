import { create } from "zustand";

import type { ArtifactActionState } from "@/components/publish/ArtifactActions";
import type {
  ProviderPublishSpec,
  PublishResult,
} from "@/features/publish/publishRuntime";

interface PublishStore {
  // ── State ──
  isPublishing: boolean;
  isCancellingPublish: boolean;
  publishResult: PublishResult | null;
  lastPublishSpec: ProviderPublishSpec | null;
  currentPublishRecordId: string | null;
  releaseChecklistOpen: boolean;
  tauriReleaseOpen: boolean;
  artifactActionState: ArtifactActionState;

  // ── Setters ──
  setIsPublishing: (value: boolean) => void;
  setIsCancellingPublish: (value: boolean) => void;
  setPublishResult: (value: PublishResult | null) => void;
  setLastPublishSpec: (value: ProviderPublishSpec | null) => void;
  setCurrentPublishRecordId: (value: string | null) => void;
  setReleaseChecklistOpen: (value: boolean) => void;
  setTauriReleaseOpen: (value: boolean) => void;
  setArtifactActionState: (value: ArtifactActionState) => void;
}

export const usePublishStore = create<PublishStore>((set) => ({
  isPublishing: false,
  isCancellingPublish: false,
  publishResult: null,
  lastPublishSpec: null,
  currentPublishRecordId: null,
  releaseChecklistOpen: false,
  tauriReleaseOpen: false,
  artifactActionState: { packageResult: null, signResult: null },

  setIsPublishing: (value) => set({ isPublishing: value }),
  setIsCancellingPublish: (value) => set({ isCancellingPublish: value }),
  setPublishResult: (value) => set({ publishResult: value }),
  setLastPublishSpec: (value) => set({ lastPublishSpec: value }),
  setCurrentPublishRecordId: (value) => set({ currentPublishRecordId: value }),
  setReleaseChecklistOpen: (value) => set({ releaseChecklistOpen: value }),
  setTauriReleaseOpen: (value) => set({ tauriReleaseOpen: value }),
  setArtifactActionState: (value) => set({ artifactActionState: value }),
}));
