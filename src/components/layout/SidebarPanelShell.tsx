import { cn } from "@/lib/utils";

import { CollapsiblePanel } from "@/components/layout/CollapsiblePanel";

export interface SidebarPanelShellProps {
  collapsed: boolean;
  width: string;
  className?: string;
  children: React.ReactNode;
}

export function SidebarPanelShell({
  collapsed,
  width,
  className,
  children,
}: SidebarPanelShellProps) {
  return (
    <div
      className={cn(
        "flex flex-col p-2 transition-all duration-300 ease-in-out",
        collapsed && "p-0"
      )}
    >
      <CollapsiblePanel
        collapsed={collapsed}
        side="left"
        width={width}
        className={cn("glass-card repo-sidebar-shell h-full rounded-2xl", className)}
      >
        {children}
      </CollapsiblePanel>
    </div>
  );
}
