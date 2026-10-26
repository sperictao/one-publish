import * as React from "react";
import { cn } from "@/lib/utils";

interface CollapsiblePanelProps {
  children: React.ReactNode;
  collapsed: boolean;
  side: "left" | "right";
  width?: string;
  className?: string;
}

export function CollapsiblePanel({
  children,
  collapsed,
  side: _side,
  width = "240px",
  className,
}: CollapsiblePanelProps) {
  return (
    <div
      className={cn(
        "relative flex flex-col border-r border-border transition-[width,min-width,border-color] duration-200 ease-geist overflow-hidden",
        collapsed && "w-0 min-w-0 border-r-0",
        className
      )}
      style={{
        width: collapsed ? 0 : width,
        minWidth: collapsed ? 0 : width,
      }}
    >
      {/* Panel Content */}
      <div
        className={cn(
          "flex-1 overflow-hidden transition-opacity duration-200",
          collapsed ? "opacity-0 pointer-events-none" : "opacity-100"
        )}
      >
        {children}
      </div>
    </div>
  );
}
