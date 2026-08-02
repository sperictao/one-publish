import { useCallback, useMemo, type ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";

import { ParameterField } from "@/components/publish/ParameterField";
import { Card, CardContent } from "@/components/ui/card";
import { SectionShell } from "@/components/ui/section-shell";
import { useI18n } from "@/hooks/useI18n";
import type {
  ParameterDefinition,
  ParameterSchema,
  ParameterValue,
} from "@/types/parameters";

function defaultParameterValue(
  definition: ParameterDefinition
): ParameterValue {
  switch (definition.type) {
    case "boolean":
      return false;
    case "array":
      return [];
    case "map":
      return {};
    default:
      return "";
  }
}

interface ProviderParameterFormSectionsProps {
  mode?: "edit" | "readonly";
  schema?: ParameterSchema;
  parameters: Record<string, ParameterValue>;
  onParameterChange?: (key: string, value: ParameterValue) => void;
}

export function ProviderParameterFormSections({
  mode = "edit",
  schema,
  parameters,
  onParameterChange,
}: ProviderParameterFormSectionsProps): ReactNode {
  const { t } = useI18n();
  const readOnly = mode === "readonly";

  const fields = useMemo(
    () =>
      Object.entries(schema?.parameters ?? {}).map(([key, definition]) => ({
        key,
        definition,
        value: parameters[key] ?? defaultParameterValue(definition),
      })),
    [schema, parameters]
  );

  const handleChange = useCallback(
    (key: string, value: ParameterValue) => {
      if (readOnly) {
        return;
      }
      onParameterChange?.(key, value);
    },
    [onParameterChange, readOnly]
  );

  return (
    <SectionShell
      icon={SlidersHorizontal}
      title={t("profiles.providerParametersSection")}
      description={t("profiles.providerParametersSectionDescription")}
    >
      {!schema ? (
        <div className="text-label-12 text-muted-foreground">
          {t("profiles.providerParametersSchemaLoading")}
        </div>
      ) : fields.length === 0 ? (
        <div className="text-label-12 text-muted-foreground">
          {t("profiles.providerParametersEmpty")}
        </div>
      ) : (
        <div className="space-y-3">
          {fields.map((field) => (
            <Card key={field.key}>
              <CardContent className="pt-2">
                <ParameterField
                  id={`provider-parameter-${field.key}`}
                  label={field.key}
                  definition={field.definition}
                  value={field.value}
                  onChange={(value) => handleChange(field.key, value)}
                  readOnly={readOnly}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </SectionShell>
  );
}
