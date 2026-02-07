import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { X, Plus, HelpCircle } from "lucide-react";
import { ParameterDefinition, ParameterValue } from "@/types/parameters";

interface MapParameterProps {
  definition: ParameterDefinition;
  value: Record<string, ParameterValue>;
  onChange: (value: Record<string, ParameterValue>) => void;
}

export function MapParameter({ definition, value, onChange }: MapParameterProps) {
  const entries = Object.entries(value);

  const addEntry = () => {
    onChange({ ...value, [`key_${entries.length}`]: "" });
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
        <div className="flex items-center space-x-2">
          <Label>{definition.flag || definition.prefix}</Label>
          {definition.description && (
            <div className="group relative inline-block">
              <HelpCircle
                className="h-4 w-4 text-muted-foreground cursor-help"
                aria-label="Help"
                aria-hidden={false}
              />
              <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block w-64 p-2 bg-popover text-popover-foreground text-sm rounded shadow-lg z-10">
                {definition.description}
              </div>
            </div>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addEntry}
        >
          <Plus className="h-4 w-4 mr-1" />
          Add
        </Button>
      </div>
      <div className="space-y-2">
        {entries.map(([key, val]) => (
          <div key={key} className="flex items-center space-x-2">
            <Input
              type="text"
              value={key}
              onChange={(e) => updateKey(key, e.target.value)}
              placeholder="Key"
              className="w-1/3"
            />
            <Input
              type="text"
              value={String(val)}
              onChange={(e) => updateValue(key, e.target.value)}
              placeholder="Value"
              className="flex-1"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove entry ${key}`}
              onClick={() => removeEntry(key)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
        {entries.length === 0 && (
          <div className="text-sm text-muted-foreground italic">
            No entries added
          </div>
        )}
      </div>
    </div>
  );
}
