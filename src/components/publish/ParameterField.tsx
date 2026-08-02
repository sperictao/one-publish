import type { ReactNode } from "react";

import { ArrayParameter } from "@/components/publish/ArrayParameter";
import { BooleanParameter } from "@/components/publish/BooleanParameter";
import { MapParameter } from "@/components/publish/MapParameter";
import { StringParameter } from "@/components/publish/StringParameter";
import type { ParameterDefinition, ParameterValue } from "@/types/parameters";

interface ParameterFieldProps {
  id: string;
  label: string;
  definition: ParameterDefinition;
  value: ParameterValue;
  onChange: (value: ParameterValue) => void;
  readOnly?: boolean;
}

export function ParameterField({
  id,
  label,
  definition,
  value,
  onChange,
  readOnly = false,
}: ParameterFieldProps): ReactNode {
  if (definition.type === "boolean") {
    return (
      <BooleanParameter
        definition={definition}
        value={Boolean(value)}
        onChange={onChange}
        readOnly={readOnly}
        label={label}
        inputId={id}
      />
    );
  }

  if (definition.type === "string") {
    return (
      <StringParameter
        definition={definition}
        value={typeof value === "string" ? value : ""}
        onChange={onChange}
        readOnly={readOnly}
        label={label}
        inputId={id}
      />
    );
  }

  if (definition.type === "array") {
    return (
      <ArrayParameter
        definition={definition}
        value={Array.isArray(value) ? value : []}
        onChange={onChange}
        readOnly={readOnly}
        label={label}
      />
    );
  }

  return (
    <MapParameter
      definition={definition}
      value={
        value && typeof value === "object" && !Array.isArray(value)
          ? (value as Record<string, ParameterValue>)
          : {}
      }
      onChange={onChange}
      readOnly={readOnly}
      label={label}
    />
  );
}
