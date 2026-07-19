import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-sm font-medium ring-offset-background transition-[color,background-color,border-color,transform] duration-150 ease-geist enabled:active:scale-[0.98] focus-ring disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-700",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-gray-900",
        destructive: "bg-red-800 text-white hover:bg-red-900",
        outline:
          "border border-border bg-transparent text-foreground hover:border-gray-alpha-500 active:border-gray-alpha-600 disabled:border-transparent",
        secondary:
          "bg-background text-foreground border border-border hover:border-gray-alpha-500 active:border-gray-alpha-600 disabled:border-transparent",
        ghost:
          "text-foreground hover:bg-gray-alpha-100 active:bg-gray-alpha-200",
        link: "text-interactive underline-offset-4 hover:underline disabled:bg-transparent",
      },
      size: {
        default: "h-10 px-2.5 text-button-14",
        sm: "h-8 rounded-sm px-1.5 text-button-14",
        lg: "h-12 rounded-sm px-3.5 text-button-16",
        icon: "size-10 rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button };
