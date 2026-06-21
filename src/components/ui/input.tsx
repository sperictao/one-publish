import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  /**
   * 裸模式：不应用 `surface-input`（无边框/背景/聚焦 ring）。
   * 用于外层容器已承载输入框视觉的场景（如带图标的搜索框），
   * 避免 surface-input 嵌套导致聚焦时出现双重外框。
   */
  bare?: boolean;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, bare, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          bare
            ? "flex h-10 w-full rounded-sm px-3 py-2 text-label-14 bg-transparent border-none outline-none placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            : "surface-input flex h-10 w-full rounded-sm px-3 py-2 text-label-14 ring-offset-background file:border-0 file:bg-transparent file:text-button-14 file:font-medium placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
