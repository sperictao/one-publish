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
}: AppDialogInsetProps): ReactNode {
  return (
    <Component
      className={cn(
        "rounded-md border border-border bg-background p-4",
        className
      )}
    >
      {children}
    </Component>
  );
}
