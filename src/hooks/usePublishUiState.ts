import { useState } from "react";

import type { ArtifactActionState } from "@/components/publish/ArtifactActions";
import type {
  ProviderPublishSpec,
  PublishResult,
} from "@/lib/publishRuntime";

export function usePublishUiState() {
  const [isPublishing, setIsPublishing] = useState(false);
  const [isCancellingPublish, setIsCancellingPublish] = useState(false);
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null);
  const [lastPublishSpec, setLastPublishSpec] =
    useState<ProviderPublishSpec | null>(null);
  const [currentPublishRecordId, setCurrentPublishRecordId] =
    useState<string | null>(null);
  const [releaseChecklistOpen, setReleaseChecklistOpen] = useState(false);
  const [artifactActionState, setArtifactActionState] =
    useState<ArtifactActionState>({
      packageResult: null,
      signResult: null,
    });

  return {
    isPublishing,
    setIsPublishing,
    isCancellingPublish,
    setIsCancellingPublish,
    publishResult,
    setPublishResult,
    lastPublishSpec,
    setLastPublishSpec,
    currentPublishRecordId,
    setCurrentPublishRecordId,
    releaseChecklistOpen,
    setReleaseChecklistOpen,
    artifactActionState,
    setArtifactActionState,
  };
}
