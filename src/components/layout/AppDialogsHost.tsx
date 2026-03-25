import { AppDialogs } from "@/components/layout/AppDialogs";
import {
  useDialogsCompositionState,
  type DialogsCompositionParams,
} from "@/hooks/useDialogsCompositionState";

export type AppDialogsHostProps = DialogsCompositionParams;

export function AppDialogsHost(props: AppDialogsHostProps) {
  const { appDialogsProps } = useDialogsCompositionState(props);

  return <AppDialogs {...appDialogsProps} />;
}
