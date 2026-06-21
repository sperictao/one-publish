import * as React from "react";
import { HelpCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface HelpTipProps {
  /** 提示正文 */
  text: React.ReactNode;
  /** 无障碍标签，供屏幕阅读器朗读触发按钮 */
  label?: string;
  /** 提示内容水平对齐，转发给 Radix TooltipContent */
  align?: "start" | "center" | "end";
  className?: string;
}

/**
 * 可聚焦的帮助提示触发器，替代仅 hover 可见的 group-hover 方案。
 * 键盘聚焦、触摸聚焦均可唤出提示，满足 WCAG 可达性。
 */
export function HelpTip({
  text,
  label = "查看说明",
  align,
  className,
}: HelpTipProps) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className={cn(
              "inline-flex size-4 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:text-foreground focus-ring",
              className
            )}
          >
            <HelpCircle className="size-4" aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent align={align}>{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
