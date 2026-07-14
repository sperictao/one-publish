import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * 骨架占位原语。gray-alpha 底 + pulse；reduced-motion 由 index.css
 * 全局降级规则接管（pulse 自动静止）。形状由调用方通过 className 决定。
 */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-gray-alpha-100", className)}
      {...props}
    />
  );
}
