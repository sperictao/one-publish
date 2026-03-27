import { memo, useMemo } from "react";

import { ArrayParameter } from "@/components/publish/ArrayParameter";
import { BooleanParameter } from "@/components/publish/BooleanParameter";
import { MapParameter } from "@/components/publish/MapParameter";
import { StringParameter } from "@/components/publish/StringParameter";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { SectionShell } from "@/components/ui/section-shell";
import {
  DOTNET_ADVANCED_PARAMETER_KEYS,
} from "@/lib/dotnetPublishConfig";
import type { ParameterSchema, ParameterValue } from "@/types/parameters";
import { FileCog } from "lucide-react";

type TranslationMap = Record<string, string | undefined>;

interface DotnetAdvancedParametersSectionProps {
  profileT: TranslationMap;
  dotnetSchema?: ParameterSchema;
  parameters: Record<string, ParameterValue>;
  onParameterChange: (key: string, value: ParameterValue) => void;
}

function getParameterDefaultValue(type: string): ParameterValue {
  switch (type) {
    case "boolean":
      return false;
    case "array":
      return [];
    case "map":
      return {};
    case "string":
    default:
      return "";
  }
}

export const DotnetAdvancedParametersSection = memo(
  function DotnetAdvancedParametersSection({
    profileT,
    dotnetSchema,
    parameters,
    onParameterChange,
  }: DotnetAdvancedParametersSectionProps) {
    const advancedEntries = useMemo(
      () =>
        DOTNET_ADVANCED_PARAMETER_KEYS.flatMap((key) => {
          const definition = dotnetSchema?.parameters[key];
          return definition ? [[key, definition] as const] : [];
        }),
      [dotnetSchema]
    );

    if (advancedEntries.length === 0) {
      return null;
    }

    return (
      <SectionShell
        icon={FileCog}
        title={profileT.quickCreateAdvancedSection || "高级参数"}
        description={
          profileT.quickCreateAdvancedSectionDescription ||
          "补充框架、日志、MSBuild 属性和自定义 define，覆盖更多发布场景。"
        }
      >
        <div className="space-y-4">
          {advancedEntries.map(([key, definition]) => {
            const value =
              parameters[key] ?? getParameterDefaultValue(definition.type);

            return (
              <Card key={key} className="rounded-2xl">
                <CardHeader className="pb-2">
                  <div className="text-sm font-semibold text-foreground">
                    {key}
                  </div>
                  <CardDescription className="text-xs leading-5">
                    {definition.description || definition.flag}
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  {definition.type === "boolean" ? (
                    <BooleanParameter
                      definition={definition}
                      value={value as boolean}
                      onChange={(nextValue) =>
                        onParameterChange(key, nextValue)
                      }
                    />
                  ) : null}
                  {definition.type === "string" ? (
                    <StringParameter
                      definition={definition}
                      value={value as string}
                      onChange={(nextValue) =>
                        onParameterChange(key, nextValue)
                      }
                    />
                  ) : null}
                  {definition.type === "array" ? (
                    <ArrayParameter
                      definition={definition}
                      value={value as ParameterValue[]}
                      onChange={(nextValue) =>
                        onParameterChange(key, nextValue)
                      }
                    />
                  ) : null}
                  {definition.type === "map" ? (
                    <MapParameter
                      definition={definition}
                      value={value as Record<string, ParameterValue>}
                      onChange={(nextValue) =>
                        onParameterChange(key, nextValue)
                      }
                    />
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </SectionShell>
    );
  }
);
