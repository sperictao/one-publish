import { useEffect, useId, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { X, Plus } from "lucide-react";
import { HelpTip } from "@/components/ui/help-tip";
import { useI18n } from "@/hooks/useI18n";
import { ParameterDefinition, ParameterValue } from "@/types/parameters";

interface ArrayParameterProps {
  definition: ParameterDefinition;
  value: ParameterValue[];
  onChange: (value: ParameterValue[]) => void;
  readOnly?: boolean;
  label?: string;
}

export function ArrayParameter({
  definition,
  value,
  onChange,
  readOnly = false,
  label,
}: ArrayParameterProps) {
  const resolvedLabel = label || definition.flag;
  const fieldLabelId = useId();
  const { t } = useI18n();

  // Stable ids per array slot so add/remove/rename does not steal focus.
  const nextIdRef = useRef(0);
  const idPoolRef = useRef<string[]>([]);
  // Eagerly fill the pool before the mapping render so every row has a key.
  if (value.length > idPoolRef.current.length) {
    while (value.length > idPoolRef.current.length) {
      idPoolRef.current.push(`array-item-${++nextIdRef.current}`);
    }
  }
  useEffect(() => {
    if (value.length < idPoolRef.current.length) {
      idPoolRef.current = idPoolRef.current.slice(0, value.length);
    }
  }, [value.length]);

  const addItem = () => {
    onChange([...value, ""]);
  };

  const removeItem = (index: number) => {
    const newValue = value.filter((_, i) => i !== index);
    onChange(newValue);
  };

  const updateItem = (index: number, itemValue: string) => {
    const newValue = value.map((item, i) => (i === index ? itemValue : item));
    onChange(newValue);
  };

  return (
    <div className="space-y-2 py-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-x-2">
          <Label id={fieldLabelId}>{resolvedLabel}</Label>
          {definition.description && (
            <HelpTip text={definition.description} />
          )}
        </div>
        {!readOnly ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addItem}
          >
            <Plus className="size-4 mr-1" />
            {t("common.add")}
          </Button>
        ) : null}
      </div>
      <div className="space-y-2" role="group" aria-labelledby={fieldLabelId}>
        {value.map((item, index) => (
          <div key={idPoolRef.current[index]} className="flex items-center gap-x-2">
            <Input
              type="text"
              value={String(item)}
              onChange={(e) => updateItem(index, e.target.value)}
              placeholder={t("common.arrayItemPlaceholder", { index: index + 1 })}
              readOnly={readOnly}
            />
            {!readOnly ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("common.removeArrayItem", { index: index + 1 })}
                onClick={() => removeItem(index)}
              >
                <X className="size-4" />
              </Button>
            ) : null}
          </div>
        ))}
        {value.length === 0 && (
          <div className="text-sm text-muted-foreground italic">
            {t("common.noItemsAdded")}
          </div>
        )}
      </div>
    </div>
  );
}
