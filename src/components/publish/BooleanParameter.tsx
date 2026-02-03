import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { HelpCircle } from "lucide-react";
import { ParameterDefinition } from "@/types/parameters";

interface BooleanParameterProps {
  definition: ParameterDefinition;
  value: boolean;
  onChange: (value: boolean) => void;
}

export function BooleanParameter({ definition, value, onChange }: BooleanParameterProps) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center space-x-2">
        <Label htmlFor={definition.flag} className="cursor-pointer">
          {definition.flag}
        </Label>
        {definition.description && (
          <div className="group relative inline-block">
            <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
            <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block w-64 p-2 bg-popover text-popover-foreground text-sm rounded shadow-lg z-10">
              {definition.description}
            </div>
          </div>
        )}
      </div>
      <Switch
        id={definition.flag}
        checked={value}
        onCheckedChange={onChange}
      />
    </div>
  );
}
