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
    "border-[var(--glass-border-subtle)] bg-background/70 text-muted-foreground",
  info: "border-sky-200/80 bg-sky-500/10 text-sky-700 dark:border-sky-500/30 dark:text-sky-300",
  success:
    "border-emerald-200/80 bg-emerald-500/10 text-emerald-700 dark:border-emerald-500/30 dark:text-emerald-300",
  warning:
    "border-amber-200/80 bg-amber-500/10 text-amber-700 dark:border-amber-500/30 dark:text-amber-300",
  danger:
    "border-rose-200/80 bg-rose-500/10 text-rose-700 dark:border-rose-500/30 dark:text-rose-300",
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
}: AppDialogBadgeProps): JSX.Element {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium tracking-[0.01em]",
        badgeVariantClassName[variant],
        className
      )}
    >
      {icon}
      <span>{children}</span>
    </span>
  );
}
