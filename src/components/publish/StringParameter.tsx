import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HelpTip } from "@/components/ui/help-tip";
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
          <HelpTip text={definition.description} />
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
