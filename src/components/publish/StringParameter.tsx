import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HelpCircle } from "lucide-react";
import { ParameterDefinition } from "@/types/parameters";

interface StringParameterProps {
  definition: ParameterDefinition;
  value: string;
  onChange: (value: string) => void;
}

export function StringParameter({ definition, value, onChange }: StringParameterProps) {
  return (
    <div className="space-y-2 py-2">
      <div className="flex items-center space-x-2">
        <Label htmlFor={definition.flag}>{definition.flag}</Label>
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
      <Input
        id={definition.flag}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`Enter ${definition.flag}...`}
      />
    </div>
  );
}
