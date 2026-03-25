import { useEffect, type Dispatch, type SetStateAction } from "react";
import { AppDialogs } from "@/components/layout/AppDialogs";
import {
  useDialogsCompositionState,
  type DialogsCompositionParams,
} from "@/hooks/useDialogsCompositionState";
import {
  useCommandImport,
  type ImportFeedback,
} from "@/hooks/useCommandImport";
import type { ParameterSchema, ParameterValue } from "@/types/parameters";

interface DotnetConfigPatch {
  configuration?: string;
  runtime?: string;
  outputDir?: string;
  selfContained?: boolean;
  useProfile?: boolean;
  profileName?: string;
}

export type AppDialogsHostProps = Omit<
  DialogsCompositionParams,
  "handleCommandImport"
> & {
  providerSchemas: Record<string, ParameterSchema>;
  onDotnetConfigUpdate: (patch: DotnetConfigPatch) => void;
  onEnableCustomMode: () => void;
  setProviderParameters: Dispatch<
    SetStateAction<Record<string, Record<string, ParameterValue>>>
  >;
  onCommandImportFeedbackChange: (feedback: ImportFeedback | null) => void;
};

export function AppDialogsHost(props: AppDialogsHostProps) {
  const {
    providerSchemas,
    onDotnetConfigUpdate,
    onEnableCustomMode,
    setProviderParameters,
    onCommandImportFeedbackChange,
    ...dialogsCompositionParams
  } = props;
  const { activeImportFeedback, handleCommandImport } = useCommandImport({
    activeProviderId: dialogsCompositionParams.activeProviderId,
    appT: dialogsCompositionParams.appT,
    providerSchemas,
    onDotnetConfigUpdate,
    onEnableCustomMode,
    setProviderParameters,
  });

  useEffect(() => {
    if (!activeImportFeedback) {
      return;
    }

    onCommandImportFeedbackChange(activeImportFeedback);
  }, [activeImportFeedback, onCommandImportFeedbackChange]);

  const { appDialogsProps } = useDialogsCompositionState({
    ...dialogsCompositionParams,
    handleCommandImport,
  });

  return <AppDialogs {...appDialogsProps} />;
}
