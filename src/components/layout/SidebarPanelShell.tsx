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
        "flex flex-col",
        collapsed ? "p-0" : "p-2"
      )}
    >
      <CollapsiblePanel
        collapsed={collapsed}
        side="left"
        width={width}
        className={cn("surface-raised h-full rounded-md", className)}
      >
        {children}
      </CollapsiblePanel>
    </div>
  );
}
