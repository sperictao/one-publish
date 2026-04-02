import { useEffect, useRef } from "react";
import { toast } from "sonner";

export function useStartupRecoveryNotice(startupNotice?: string | null) {
  const shownNoticeRef = useRef<string | null>(null);

  useEffect(() => {
    const nextNotice = startupNotice?.trim();
    if (!nextNotice || shownNoticeRef.current === nextNotice) {
      return;
    }

    shownNoticeRef.current = nextNotice;
    toast.warning("已恢复安全配置", {
      description: nextNotice,
    });
  }, [startupNotice]);
}
