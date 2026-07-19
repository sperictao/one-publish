import * as React from "react";
import { cn } from "@/lib/utils";

export interface CollapseProps {
  open: boolean;
  className?: string;
  children: React.ReactNode;
}

/**
 * 高度折叠过渡容器：grid-template-rows 0fr↔1fr 技巧。
 * 纯 CSS 可动画、无 JS 测量、无 max-height 魔法数字；
 * reduced-motion 由 index.css 全局降级规则接管。
 * 内容始终挂载（利于动画与无障碍树稳定），收起时不可聚焦。
 */
export function Collapse({ open, className, children }: CollapseProps) {
  return (
    <div
      className={cn(
        "grid transition-[grid-template-rows] duration-200 ease-move",
        open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        className
      )}
    >
      <div
        className="min-h-0 overflow-hidden"
        {...(open ? {} : { inert: "" as never })}
      >
        {children}
      </div>
    </div>
  );
}
