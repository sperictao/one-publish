import * as React from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/hooks/useI18n";

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
        "relative flex flex-col border-r border-[var(--glass-divider)] glass-panel transition-[width,min-width,border-color] duration-300 ease-in-out overflow-hidden",
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

// Toggle button component for title bar
export type PanelIconType = "sidebar" | "folder" | "branch";

interface PanelToggleButtonProps {
  collapsed: boolean;
  onToggle: () => void;
  /** Icon type shown in button */
  iconType?: PanelIconType;
  /** Tooltip text */
  tooltip?: string;
}

export function PanelToggleButton({
  collapsed,
  onToggle,
  iconType = "sidebar",
  tooltip,
}: PanelToggleButtonProps) {
  const { translations } = useI18n();
  const commonT = translations.common || {};
  const defaultTooltip = collapsed
    ? commonT.expandSidebar || "展开侧边栏"
    : commonT.collapseSidebar || "收起侧边栏";

  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded hover:bg-accent transition-colors",
        collapsed ? "text-muted-foreground hover:text-foreground" : "text-foreground"
      )}
      title={tooltip || defaultTooltip}
    >
      <PanelIcon type={iconType} />
    </button>
  );
}

function PanelIcon({ type }: { type: PanelIconType }) {
  switch (type) {
    case "folder":
      return <FolderIcon />;
    case "branch":
      return <BranchIcon />;
    default:
      return <SidebarIcon />;
  }
}

// Folder icon matching the reference design
function FolderIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Folder back */}
      <path
        d="M2 6c0-1.1.9-2 2-2h5l2 2h9c1.1 0 2 .9 2 2v10c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Folder tab */}
      <path
        d="M2 8H22"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

// Git branch icon matching the reference design
function BranchIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Main vertical line */}
      <line x1="6" y1="6" x2="6" y2="18" stroke="currentColor" strokeWidth="1.5" />
      {/* Branch line */}
      <path
        d="M6 12C6 12 6 9 12 9C18 9 18 6 18 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
      {/* Top node */}
      <circle cx="6" cy="6" r="2.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
      {/* Bottom node */}
      <circle cx="6" cy="18" r="2.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
      {/* Branch node */}
      <circle cx="18" cy="6" r="2.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  );
}

// Sidebar toggle icon
function SidebarIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Sidebar frame */}
      <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
      {/* Sidebar divider */}
      <line x1="6" y1="2" x2="6" y2="14" stroke="currentColor" strokeWidth="1.5" />
      {/* Arrow pointing left */}
      <path d="M11 6L8 8L11 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
