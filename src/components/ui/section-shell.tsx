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
  /** Heading level for the section title. Defaults to h3. */
  headingLevel?: "h2" | "h3" | "h4";
}

export function SectionShell({
  icon: Icon,
  title,
  description,
  children,
  collapsible = false,
  defaultExpanded = true,
  badge,
  headingLevel = "h3",
}: SectionShellProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const Heading = headingLevel;
  const headerContent = (
    <>
      <span className="flex size-8 flex-shrink-0 items-center justify-center rounded-md bg-interactive/10 text-interactive">
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1 text-left">
        <Heading className="text-sm font-semibold text-foreground">{title}</Heading>
        <CardDescription className="mt-0.5 text-[11px] leading-4 text-[hsl(var(--text-fine))]">
          {description}
        </CardDescription>
      </div>
      {badge ? (
        <span className="rounded-full bg-interactive/10 px-2 py-0.5 text-[10px] font-semibold text-interactive">
          {badge}
        </span>
      ) : null}
    </>
  );

  return (
    <Card className="rounded-sm">
      <CardHeader className="p-4 pb-2.5">
        {collapsible ? (
          <button
            type="button"
            className="flex w-full items-start gap-2.5 text-left"
            aria-expanded={expanded}
            onClick={() => setExpanded((previous) => !previous)}
          >
            {headerContent}
            {expanded ? (
              <ChevronDown className="mt-0.5 size-4 flex-shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="mt-0.5 size-4 flex-shrink-0 text-muted-foreground" />
            )}
          </button>
        ) : (
          <div className="flex items-start gap-2.5">{headerContent}</div>
        )}
      </CardHeader>
      {!collapsible || expanded ? (
        <CardContent className="p-4 pt-0">{children}</CardContent>
      ) : null}
    </Card>
  );
}
