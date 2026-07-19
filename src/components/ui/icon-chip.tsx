import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type IconChipSize = "sm" | "md" | "lg";

const sizeClassName: Record<IconChipSize, string> = {
  sm: "size-7",
  md: "size-8",
  lg: "size-10",
};

interface IconChipProps {
  children: ReactNode;
  className?: string;
  size?: IconChipSize;
}

/** Geist 图标 chip：interactive/10 底 + interactive 前景，6px 圆角。 */
export function IconChip({
  children,
  className,
  size = "md",
}: IconChipProps): ReactNode {
  return (
    <span
      className={cn(
        "flex flex-shrink-0 items-center justify-center rounded-sm bg-interactive/10 text-interactive",
        sizeClassName[size],
        className
      )}
    >
      {children}
    </span>
  );
}
