import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { HelpTip } from "@/components/ui/help-tip";
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
          <HelpTip text={definition.description} />
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
