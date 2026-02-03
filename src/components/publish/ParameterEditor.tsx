import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ParameterSchema, ParameterValue } from "@/types/parameters";
import { BooleanParameter } from "./BooleanParameter";
import { StringParameter } from "./StringParameter";
import { ArrayParameter } from "./ArrayParameter";
import { MapParameter } from "./MapParameter";

interface ParameterEditorProps {
  schema: ParameterSchema;
  parameters: Record<string, ParameterValue>;
  onChange: (parameters: Record<string, ParameterValue>) => void;
}

export function ParameterEditor({ schema, parameters, onChange }: ParameterEditorProps) {
  const updateParameter = (key: string, value: ParameterValue) => {
    onChange({ ...parameters, [key]: value });
  };

  const entries = Object.entries(schema.parameters);

  if (entries.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center text-muted-foreground">
            No parameters defined for this provider
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {entries.map(([key, definition]) => {
        const value = parameters[key] ?? getDefaultValue(definition.type);

        return (
          <Card key={key}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{key}</CardTitle>
              <CardDescription>
                Type: {definition.type}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {definition.type === 'boolean' && (
                <BooleanParameter
                  definition={definition}
                  value={value as boolean}
                  onChange={(v) => updateParameter(key, v)}
                />
              )}
              {definition.type === 'string' && (
                <StringParameter
                  definition={definition}
                  value={value as string}
                  onChange={(v) => updateParameter(key, v)}
                />
              )}
              {definition.type === 'array' && (
                <ArrayParameter
                  definition={definition}
                  value={value as ParameterValue[]}
                  onChange={(v) => updateParameter(key, v)}
                />
              )}
              {definition.type === 'map' && (
                <MapParameter
                  definition={definition}
                  value={value as Record<string, ParameterValue>}
                  onChange={(v) => updateParameter(key, v)}
                />
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function getDefaultValue(type: string): ParameterValue {
  switch (type) {
    case 'boolean':
      return false;
    case 'string':
      return '';
    case 'array':
      return [];
    case 'map':
      return {};
    default:
      return null;
  }
}
