import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type AppDialogBadgeVariant =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger";

const badgeVariantClassName: Record<AppDialogBadgeVariant, string> = {
  neutral:
    "border-border bg-muted text-muted-foreground",
  info: "status-info",
  success: "status-success",
  warning: "status-cancelled",
  danger: "status-failed",
};

interface AppDialogBadgeProps {
  children: ReactNode;
  className?: string;
  variant?: AppDialogBadgeVariant;
  icon?: ReactNode;
}

export function AppDialogBadge({
  children,
  className,
  variant = "neutral",
  icon,
}: AppDialogBadgeProps): ReactNode {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-label-12 font-semibold",
        badgeVariantClassName[variant],
        className
      )}
    >
      {icon}
      <span>{children}</span>
    </span>
  );
}
