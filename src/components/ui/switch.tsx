import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "glass-press peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-background data-[state=unchecked]:border-border data-[state=unchecked]:",
      className
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block h-5 w-5 rounded-full bg-background shadow-none ring-0 transition-transform duration-200 data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0"
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

interface SwitchIndicatorProps extends React.HTMLAttributes<HTMLSpanElement> {
  checked: boolean;
  thumbClassName?: string;
}

const SwitchIndicator = React.forwardRef<HTMLSpanElement, SwitchIndicatorProps>(
  ({ checked, className, thumbClassName, ...props }, ref) => (
    <span
      aria-hidden="true"
      data-state={checked ? "checked" : "unchecked"}
      className={cn(
        "inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-transparent transition duration-200 data-[state=checked]:bg-primary data-[state=unchecked]:bg-background data-[state=unchecked]:border-border data-[state=unchecked]:",
        className
      )}
      {...props}
      ref={ref}
    >
      <span
        data-state={checked ? "checked" : "unchecked"}
        className={cn(
          "pointer-events-none block size-5 rounded-full bg-background shadow-none ring-0 transition-transform duration-200 data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0",
          thumbClassName
        )}
      />
    </span>
  )
);
SwitchIndicator.displayName = "SwitchIndicator";

export { Switch, SwitchIndicator };
