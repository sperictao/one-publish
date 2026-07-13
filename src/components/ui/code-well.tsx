import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface CodeWellProps {
  children: ReactNode;
  className?: string;
  as?: "pre" | "div";
}

/** Geist mono 代码井：muted 底、border、6px 圆角、mono 排版 token。 */
export function CodeWell({ children, className, as: Component = "pre" }: CodeWellProps): ReactNode {
  return (
    <Component
      className={cn(
        "rounded-sm border border-border bg-muted p-3 font-mono text-label-12-mono text-foreground whitespace-pre-wrap break-all",
        className
      )}
    >
      {children}
    </Component>
  );
}
