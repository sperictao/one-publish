import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  hint?: string;
  /** 可选行动区（按钮等），置于提示文案下方。 */
  action?: React.ReactNode;
  className?: string;
}

/**
 * 统一空态：图标容器 + 主文案 + 可选提示 + 可选行动。
 * 基准取自仓库列表空态，全应用空态收敛到此组件以保持视觉一致。
 */
export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-4 py-8 text-center",
        className
      )}
    >
      <div className="surface-raised flex size-16 items-center justify-center rounded-lg">
        <Icon className="size-7 text-muted-foreground/30" />
      </div>
      <div>
        <p className="text-label-14 font-normal text-foreground/60">{title}</p>
        {hint ? (
          <p className="mt-1 text-label-12 text-muted-foreground">{hint}</p>
        ) : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
