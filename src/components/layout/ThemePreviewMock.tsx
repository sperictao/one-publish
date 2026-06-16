import { cn } from "@/lib/utils";

/**
 * Theme preview mock used by the settings appearance section.
 *
 * The miniature macOS-window chrome is illustrative content. Its palette is now
 * exposed as CSS custom properties so the mock can render both light and dark
 * variants side-by-side while staying out of the component's inline color surface.
 */

interface ThemePreviewMockProps {
  theme: "light" | "dark";
  previewColor: string;
  sidebarWidth?: 14 | 18;
  showAllSidebarLines?: boolean;
  hideSidebar?: boolean;
  className?: string;
}

function token(name: string, theme: "light" | "dark"): string {
  return `var(--theme-preview-${theme}-${name})`;
}

export function ThemePreviewMock({
  theme,
  previewColor,
  sidebarWidth = 18,
  showAllSidebarLines = true,
  hideSidebar = false,
  className = "",
}: ThemePreviewMockProps): JSX.Element {

  return (
    <div
      className={cn(
        "relative h-20 w-full overflow-hidden rounded-lg border border-[var(--settings-hairline)] flex select-none pointer-events-none shadow-sm",
        className
      )}
      style={{
        background: `linear-gradient(to bottom right, ${token("gradient-from", theme)}, ${token("gradient-via", theme)}, ${token("gradient-to", theme)})`,
      }}
    >
      <div
        className="absolute inset-x-3 bottom-0 top-3 flex flex-col overflow-hidden rounded-t-md border-t border-x"
        style={{
          backgroundColor: token("window-bg", theme),
          borderColor: token("border", theme),
          boxShadow: `0 2px 12px ${token("shadow", theme)}`,
        }}
      >
        {/* Title Bar with Traffic Lights */}
        <div
          className="flex h-3 shrink-0 items-center gap-[3px] px-1.5"
          style={{ borderBottom: `1px solid ${token("hairline", theme)}`, backgroundColor: token("titlebar-bg", theme) }}
        >
          <div
            className="size-1 rounded-full"
            style={{ backgroundColor: token("traffic-red", theme) }}
          />
          <div
            className="size-1 rounded-full"
            style={{ backgroundColor: token("traffic-yellow", theme) }}
          />
          <div
            className="size-1 rounded-full"
            style={{ backgroundColor: token("traffic-green", theme) }}
          />
        </div>
        <div className="flex min-h-0 flex-1">
          {/* Sidebar */}
          {!hideSidebar && (
          <div
            className="h-full shrink-0 space-y-0.5 p-0.5"
            style={{
              width: `${sidebarWidth}px`,
              borderRight: `1px solid ${token("sidebar-divider", theme)}`,
              backgroundColor: token("sidebar-bg", theme),
            }}
          >
            <div
              className="h-1.5 w-full rounded-[2px] transition-colors duration-300"
              style={{ backgroundColor: previewColor }}
            />
            <div
              className="h-1 w-2/3 rounded-[2px]"
              style={{ backgroundColor: token("sidebar-line", theme) }}
            />
            {showAllSidebarLines && (
              <div
                className="h-1 w-3/4 rounded-[2px]"
                style={{ backgroundColor: token("sidebar-line-secondary", theme) }}
              />
            )}
          </div>
          )}
          {/* Content Area */}
          <div className="flex-1 space-y-0.5 p-0.5" style={{ backgroundColor: token("window-bg", theme) }}>
            <div
              className="h-1.5 w-2/3 rounded-[1px]"
              style={{ backgroundColor: token("content-line", theme) }}
            />
            <div
              className="h-1.5 w-full rounded-[1px]"
              style={{ backgroundColor: token("content-line-secondary", theme) }}
            />
            {showAllSidebarLines && (
              <div
                className="h-1.5 w-1/2 rounded-[1px]"
                style={{ backgroundColor: token("content-line-secondary", theme) }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
