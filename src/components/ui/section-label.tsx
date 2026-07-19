import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SectionLabelProps {
  children: ReactNode;
  className?: string;
  as?: "div" | "span" | "p";
}

/** Geist 小节标签：大写、label-12、次级色。全库统一样式，禁止手写 tracking。 */
export function SectionLabel({
  children,
  className,
  as: Component = "div",
}: SectionLabelProps): ReactNode {
  return (
    <Component
      className={cn(
        "text-label-12 font-semibold uppercase text-muted-foreground",
        className
      )}
    >
      {children}
    </Component>
  );
}
