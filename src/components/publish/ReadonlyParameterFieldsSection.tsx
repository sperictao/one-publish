import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { ArrayParameter } from "@/components/publish/ArrayParameter";
import { BooleanParameter } from "@/components/publish/BooleanParameter";
import { MapParameter } from "@/components/publish/MapParameter";
import { StringParameter } from "@/components/publish/StringParameter";
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
            <Card key={field.id} className="rounded-lg">
              <CardContent className="pt-2">
                {field.definition.type === "boolean" ? (
                  <BooleanParameter
                    definition={field.definition}
                    value={Boolean(field.value)}
                    onChange={() => {}}
                    readOnly
                    label={field.label}
                    inputId={field.id}
                  />
                ) : null}
                {field.definition.type === "string" ? (
                  <StringParameter
                    definition={field.definition}
                    value={typeof field.value === "string" ? field.value : ""}
                    onChange={() => {}}
                    readOnly
                    label={field.label}
                    inputId={field.id}
                  />
                ) : null}
                {field.definition.type === "array" ? (
                  <ArrayParameter
                    definition={field.definition}
                    value={Array.isArray(field.value) ? field.value : []}
                    onChange={() => {}}
                    readOnly
                    label={field.label}
                  />
                ) : null}
                {field.definition.type === "map" ? (
                  <MapParameter
                    definition={field.definition}
                    value={
                      field.value &&
                      typeof field.value === "object" &&
                      !Array.isArray(field.value)
                        ? (field.value as Record<string, ParameterValue>)
                        : {}
                    }
                    onChange={() => {}}
                    readOnly
                    label={field.label}
                  />
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </SectionShell>
  );
}
