import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface AppDialogInsetProps {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "article" | "aside";
}

export function AppDialogInset({
  children,
  className,
  as: Component = "div",
}: AppDialogInsetProps): JSX.Element {
  return (
    <Component
      className={cn(
        "rounded-2xl border border-[var(--glass-border-subtle)] bg-[var(--glass-input-bg)] p-4 shadow-[var(--glass-inset-shadow)]",
        className
      )}
    >
      {children}
    </Component>
  );
}
