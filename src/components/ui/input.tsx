import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-xl border border-input bg-background  px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-normal placeholder:text-muted-foreground transition duration-200 focus-visible:outline-none focus-visible:border-border focus-visible:shadow-[0_0_0_3px_hsl(var(--primary)/0.12)] disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
