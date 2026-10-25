import { Children, useState } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";

import { SectionLabel } from "@/components/ui/section-label";

export interface ConfigGroupProps {
  title: string;
  count: number;
  defaultExpanded?: boolean;
  children: React.ReactNode;
  visible: boolean;
  isRefreshing?: boolean;
  emptyState?: React.ReactNode;
}

export function ConfigGroup({
  title,
  count,
  defaultExpanded = true,
  children,
  visible,
  isRefreshing = false,
  emptyState,
}: ConfigGroupProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const hasChildren = Children.count(children) > 0;

  if (!visible) return null;

  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-3 py-2 text-muted-foreground hover:text-foreground transition-colors duration-150 ease-geist"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="size-3.5" />
        ) : (
          <ChevronRight className="size-3.5" />
        )}
        <SectionLabel
          as="span"
          className="flex-1 text-left hover:text-foreground"
        >
          {title}
        </SectionLabel>
        {isRefreshing ? (
          <span className="inline-block animate-spin text-interactive">
            <Loader2 className="size-3.5" />
          </span>
        ) : null}
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-label-12 font-semibold tabular-nums">
          {count}
        </span>
      </button>
      {expanded ? (
        hasChildren ? (
          <div className="space-y-1.5">{children}</div>
        ) : emptyState ? (
          <div className="px-3 py-4 text-label-12 text-muted-foreground">
            {emptyState}
          </div>
        ) : null
      ) : null}
    </div>
  );
}
