import { useEffect, useMemo, useState } from "react";
import { CloudUpload, FolderClosed, HardDrive, Server } from "lucide-react";

import { AppDialogBadge } from "@/components/ui/app-dialog-badge";
import type { OutputTargetDescriptor } from "@/generated/tauri-contracts";
import {
  parseOutputTargetLocal,
  parseOutputTargetRemote,
  type OutputTargetHint,
} from "@/lib/outputTarget";

interface BadgeTranslations {
  outputTargetBadgeLocal?: string;
  outputTargetBadgeUnc?: string;
  outputTargetBadgeMounted?: string;
  outputTargetBadgeRemoteSuffix?: string;
  outputTargetBadgeRemoteTooltip?: string;
}

interface OutputTargetBadgeProps {
  raw: string;
  translations?: BadgeTranslations;
  className?: string;
}

const REMOTE_DEBOUNCE_MS = 300;

function deriveBadge(
  hint: OutputTargetHint,
  remote: OutputTargetDescriptor | null,
  translations?: BadgeTranslations
): {
  variant: "neutral" | "info" | "danger";
  label: string;
  detail?: string;
  tooltip?: string;
  icon: JSX.Element;
} {
  const t = translations || {};

  if (remote) {
    if (remote.kind === "mounted_remote") {
      const fsType = remote.fsType ? ` (${remote.fsType})` : "";
      if (remote.mountKind === "unc") {
        return {
          variant: "info",
          label: `${t.outputTargetBadgeUnc || "UNC 共享"}${fsType}`,
          detail: remote.host || undefined,
          icon: <Server className="size-3" aria-hidden />,
        };
      }
      return {
        variant: "info",
        label: `${t.outputTargetBadgeMounted || "挂载远程卷"}${fsType}`,
        detail: remote.path || undefined,
        icon: <HardDrive className="size-3" aria-hidden />,
      };
    }
    if (remote.kind === "remote") {
      const scheme = (remote.scheme || hint.scheme || "remote").toUpperCase();
      return {
        variant: "danger",
        label: `${scheme}${t.outputTargetBadgeRemoteSuffix || ""}`,
        detail: remote.host ? `${remote.host}${remote.path ? remote.path : ""}` : undefined,
        tooltip:
          t.outputTargetBadgeRemoteTooltip ||
          "远程协议将在 Phase 13 启用上传",
        icon: <CloudUpload className="size-3" aria-hidden />,
      };
    }
  }

  if (hint.kind === "unc") {
    return {
      variant: "info",
      label: t.outputTargetBadgeUnc || "UNC 共享",
      icon: <Server className="size-3" aria-hidden />,
    };
  }
  if (hint.kind === "scheme") {
    const scheme = (hint.scheme || "remote").toUpperCase();
    return {
      variant: "danger",
      label: `${scheme}${t.outputTargetBadgeRemoteSuffix || ""}`,
      tooltip:
        t.outputTargetBadgeRemoteTooltip || "远程协议将在 Phase 13 启用上传",
      icon: <CloudUpload className="size-3" aria-hidden />,
    };
  }
  return {
    variant: "neutral",
    label: t.outputTargetBadgeLocal || "本地",
    icon: <FolderClosed className="size-3" aria-hidden />,
  };
}

export function OutputTargetBadge({
  raw,
  translations,
  className,
}: OutputTargetBadgeProps): JSX.Element | null {
  const trimmed = raw.trim();
  const hint = useMemo(() => parseOutputTargetLocal(trimmed), [trimmed]);
  const [remote, setRemote] = useState<OutputTargetDescriptor | null>(null);

  useEffect(() => {
    if (trimmed.length === 0) {
      setRemote(null);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      parseOutputTargetRemote(trimmed)
        .then((descriptor) => {
          if (!cancelled) {
            setRemote(descriptor);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setRemote(null);
          }
        });
    }, REMOTE_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed]);

  if (trimmed.length === 0) {
    return null;
  }

  const badge = deriveBadge(hint, remote, translations);

  return (
    <span
      className={className}
      title={
        badge.tooltip ||
        (badge.detail ? `${badge.label} · ${badge.detail}` : undefined)
      }
    >
      <AppDialogBadge variant={badge.variant} icon={badge.icon}>
        {badge.label}
        {badge.detail ? (
          <span className="ml-1 text-[10px] font-normal opacity-75">
            {badge.detail}
          </span>
        ) : null}
      </AppDialogBadge>
    </span>
  );
}
