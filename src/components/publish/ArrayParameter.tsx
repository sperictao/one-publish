import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { X, Plus, HelpCircle } from "lucide-react";
import { ParameterDefinition, ParameterValue } from "@/types/parameters";

interface ArrayParameterProps {
  definition: ParameterDefinition;
  value: ParameterValue[];
  onChange: (value: ParameterValue[]) => void;
}

export function ArrayParameter({ definition, value, onChange }: ArrayParameterProps) {
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
        <div className="flex items-center space-x-2">
          <Label>{definition.flag}</Label>
          {definition.description && (
            <div className="group relative inline-block">
              <HelpCircle
                className="h-4 w-4 text-muted-foreground cursor-help"
                aria-label="Help"
                aria-hidden={false}
              />
              <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block w-64 p-2 bg-[var(--glass-panel-bg)] backdrop-blur-xl text-popover-foreground text-sm rounded-xl shadow-[var(--glass-shadow-lg)] border border-[var(--glass-border)] z-10">
                {definition.description}
              </div>
            </div>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addItem}
        >
          <Plus className="h-4 w-4 mr-1" />
          Add
        </Button>
      </div>
      <div className="space-y-2">
        {value.map((item, index) => (
          <div key={index} className="flex items-center space-x-2">
            <Input
              type="text"
              value={String(item)}
              onChange={(e) => updateItem(index, e.target.value)}
              placeholder={`Item ${index + 1}`}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove item ${index + 1}`}
              onClick={() => removeItem(index)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
        {value.length === 0 && (
          <div className="text-sm text-muted-foreground italic">
            No items added
          </div>
        )}
      </div>
    </div>
  );
}
