import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { HelpCircle } from "lucide-react";
import { ParameterDefinition } from "@/types/parameters";

interface BooleanParameterProps {
  definition: ParameterDefinition;
  value: boolean;
  onChange: (value: boolean) => void;
  readOnly?: boolean;
  label?: string;
  inputId?: string;
}

export function BooleanParameter({
  definition,
  value,
  onChange,
  readOnly = false,
  label,
  inputId,
}: BooleanParameterProps) {
  const resolvedLabel = label || definition.flag;
  const resolvedInputId = inputId || definition.flag;

  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-x-2">
        <Label htmlFor={resolvedInputId} className="cursor-pointer">
          {resolvedLabel}
        </Label>
        {definition.description && (
          <div className="group relative inline-block">
            <HelpCircle
              className="size-4 text-muted-foreground cursor-help"
              aria-label="Help"
              aria-hidden={false}
            />
            <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block w-64 p-2 bg-[var(--glass-panel-bg)] backdrop-blur-xl text-popover-foreground text-sm rounded-xl shadow-[var(--glass-shadow-lg)] border border-[var(--glass-border)] z-10">
              {definition.description}
            </div>
          </div>
        )}
      </div>
      <Switch
        id={resolvedInputId}
        checked={value}
        onCheckedChange={onChange}
        disabled={readOnly}
      />
    </div>
  );
}
