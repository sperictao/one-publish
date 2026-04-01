import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, type LucideIcon } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";

interface SectionShellProps {
  icon: LucideIcon;
  title: string;
  description: string;
  children: ReactNode;
  collapsible?: boolean;
  defaultExpanded?: boolean;
  badge?: ReactNode;
}

export function SectionShell({
  icon: Icon,
  title,
  description,
  children,
  collapsible = false,
  defaultExpanded = true,
  badge,
}: SectionShellProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const headerContent = (
    <>
      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-[0_8px_20px_hsl(var(--primary)/0.16)]">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1 text-left">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <CardDescription className="mt-1 text-xs leading-5">
          {description}
        </CardDescription>
      </div>
      {badge ? (
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
          {badge}
        </span>
      ) : null}
    </>
  );

  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-3">
        {collapsible ? (
          <button
            type="button"
            className="flex w-full items-start gap-3 text-left"
            aria-expanded={expanded}
            onClick={() => setExpanded((previous) => !previous)}
          >
            {headerContent}
            {expanded ? (
              <ChevronDown className="mt-1 h-4 w-4 flex-shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="mt-1 h-4 w-4 flex-shrink-0 text-muted-foreground" />
            )}
          </button>
        ) : (
          <div className="flex items-start gap-3">{headerContent}</div>
        )}
      </CardHeader>
      {!collapsible || expanded ? (
        <CardContent className="pt-0">{children}</CardContent>
      ) : null}
    </Card>
  );
}
