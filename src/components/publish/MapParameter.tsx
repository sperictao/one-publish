import { useEffect, useId, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { X, Plus } from "lucide-react";
import { HelpTip } from "@/components/ui/help-tip";
import { useI18n } from "@/hooks/useI18n";
import { ParameterDefinition, ParameterValue } from "@/types/parameters";

interface MapParameterProps {
  definition: ParameterDefinition;
  value: Record<string, ParameterValue>;
  onChange: (value: Record<string, ParameterValue>) => void;
  readOnly?: boolean;
  label?: string;
}

export function MapParameter({
  definition,
  value,
  onChange,
  readOnly = false,
  label,
}: MapParameterProps) {
  const entries = Object.entries(value);
  const resolvedLabel = label || definition.flag || definition.prefix;
  const fieldLabelId = useId();
  const { t } = useI18n();

  // Stable ids per map slot so key renames do not steal focus.
  const nextIdRef = useRef(0);
  const idPoolRef = useRef<string[]>([]);
  // Eagerly fill the pool before the mapping render so every row has a key.
  if (entries.length > idPoolRef.current.length) {
    while (entries.length > idPoolRef.current.length) {
      idPoolRef.current.push(`map-entry-${++nextIdRef.current}`);
    }
  }
  useEffect(() => {
    if (entries.length < idPoolRef.current.length) {
      idPoolRef.current = idPoolRef.current.slice(0, entries.length);
    }
  }, [entries.length]);

  const addEntry = () => {
    let i = entries.length;
    let newKey = `key_${i}`;
    while (newKey in value) {
      newKey = `key_${++i}`;
    }
    onChange({ ...value, [newKey]: "" });
  };

  const removeEntry = (key: string) => {
    const newValue = { ...value };
    delete newValue[key];
    onChange(newValue);
  };

  const updateKey = (oldKey: string, newKey: string) => {
    if (newKey === oldKey) return;

    const entry = value[oldKey];
    const newValue = { ...value };
    delete newValue[oldKey];
    newValue[newKey] = entry;
    onChange(newValue);
  };

  const updateValue = (key: string, itemValue: string) => {
    onChange({ ...value, [key]: itemValue });
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
            onClick={addEntry}
          >
            <Plus className="size-4 mr-1" />
            {t("common.add")}
          </Button>
        ) : null}
      </div>
      <div className="space-y-2" role="group" aria-labelledby={fieldLabelId}>
        {entries.map(([key, val], index) => (
          <div key={idPoolRef.current[index]} className="flex items-center gap-x-2">
            <Input
              type="text"
              value={key}
              onChange={(e) => updateKey(key, e.target.value)}
              placeholder={t("common.mapKeyPlaceholder")}
              className="w-1/3"
              readOnly={readOnly}
            />
            <Input
              type="text"
              value={String(val)}
              onChange={(e) => updateValue(key, e.target.value)}
              placeholder={t("common.mapValuePlaceholder")}
              className="flex-1"
              readOnly={readOnly}
            />
            {!readOnly ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("common.removeMapEntry", { key })}
                onClick={() => removeEntry(key)}
              >
                <X className="size-4" />
              </Button>
            ) : null}
          </div>
        ))}
        {entries.length === 0 && (
          <div className="text-sm text-muted-foreground italic">
            {t("common.noEntriesAdded")}
          </div>
        )}
      </div>
    </div>
  );
}
