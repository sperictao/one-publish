import { useState } from "react";

import type { ArtifactActionState } from "@/components/publish/ArtifactActions";
import type {
  ProviderPublishSpec,
  PublishResult,
} from "@/hooks/usePublishExecution";

export function usePublishUiState() {
  const [isPublishing, setIsPublishing] = useState(false);
  const [isCancellingPublish, setIsCancellingPublish] = useState(false);
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null);
  const [lastExecutedSpec, setLastExecutedSpec] =
    useState<ProviderPublishSpec | null>(null);
  const [currentExecutionRecordId, setCurrentExecutionRecordId] =
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
    lastExecutedSpec,
    setLastExecutedSpec,
    currentExecutionRecordId,
    setCurrentExecutionRecordId,
    releaseChecklistOpen,
    setReleaseChecklistOpen,
    artifactActionState,
    setArtifactActionState,
  };
}
