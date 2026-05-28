import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HelpCircle } from "lucide-react";
import { ParameterDefinition } from "@/types/parameters";

interface StringParameterProps {
  definition: ParameterDefinition;
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  label?: string;
  inputId?: string;
}

export function StringParameter({
  definition,
  value,
  onChange,
  readOnly = false,
  label,
  inputId,
}: StringParameterProps) {
  const resolvedLabel = label || definition.flag;
  const resolvedInputId = inputId || definition.flag;

  return (
    <div className="space-y-2 py-2">
      <div className="flex items-center gap-x-2">
        <Label htmlFor={resolvedInputId}>{resolvedLabel}</Label>
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
      <Input
        id={resolvedInputId}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`Enter ${definition.flag}...`}
        readOnly={readOnly}
      />
    </div>
  );
}
