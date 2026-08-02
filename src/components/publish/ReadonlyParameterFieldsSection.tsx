import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { ParameterField } from "@/components/publish/ParameterField";
import { Card, CardContent } from "@/components/ui/card";
import { SectionShell } from "@/components/ui/section-shell";
import type { ParameterDefinition, ParameterValue } from "@/types/parameters";

export interface ReadonlyParameterField {
  id: string;
  label: string;
  definition: ParameterDefinition;
  value: ParameterValue;
}

interface ReadonlyParameterFieldsSectionProps {
  icon: LucideIcon;
  title: string;
  description: string;
  fields: ReadonlyParameterField[];
  emptyLabel: string;
}

export function ReadonlyParameterFieldsSection({
  icon,
  title,
  description,
  fields,
  emptyLabel,
}: ReadonlyParameterFieldsSectionProps): ReactNode {
  return (
    <SectionShell icon={icon} title={title} description={description}>
      {fields.length === 0 ? (
        <div className="text-label-12 text-muted-foreground">{emptyLabel}</div>
      ) : (
        <div className="space-y-3">
          {fields.map((field) => (
            <Card key={field.id}>
              <CardContent className="pt-2">
                <ParameterField
                  id={field.id}
                  label={field.label}
                  definition={field.definition}
                  value={field.value}
                  onChange={() => {}}
                  readOnly
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </SectionShell>
  );
}
