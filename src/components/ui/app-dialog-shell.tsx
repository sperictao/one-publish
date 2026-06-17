import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import {
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type AppDialogShellSize = "compact" | "default" | "wide" | "workspace" | "responsive";
type AppDialogShellPadding = "default" | "none";

const contentSizeClassName: Record<AppDialogShellSize, string> = {
  compact: "sm:max-w-[560px]",
  default: "sm:max-w-[720px]",
  wide: "sm:max-w-[920px]",
  workspace: "sm:max-w-[960px]",
  responsive: "sm:max-w-[78vw]",
};

const surfaceSizeClassName: Record<AppDialogShellSize, string> = {
  compact: "max-h-[min(82vh,680px)] min-h-[360px]",
  default: "max-h-[82vh] min-h-[520px]",
  wide: "max-h-[85vh] min-h-[640px]",
  workspace: "h-[82vh]",
  responsive: "h-[82vh]",
};

interface AppDialogShellProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: AppDialogShellSize;
  bodyPadding?: AppDialogShellPadding;
  bodyScrollable?: boolean;
  dialogClassName?: string;
  surfaceClassName?: string;
  headerClassName?: string;
  bodyClassName?: string;
  bodyInnerClassName?: string;
  footerClassName?: string;
  titleClassName?: string;
  descriptionClassName?: string;
  iconWrapperClassName?: string;
  overlayClassName?: string;
  closeButtonClassName?: string;
  headerAside?: ReactNode;
}

export function AppDialogShell({
  title,
  description,
  icon,
  children,
  footer,
  size = "default",
  bodyPadding = "default",
  bodyScrollable = true,
  dialogClassName,
  surfaceClassName,
  headerClassName,
  bodyClassName,
  bodyInnerClassName,
  footerClassName,
  titleClassName,
  descriptionClassName,
  iconWrapperClassName,
  overlayClassName = "bg-background ",
  closeButtonClassName = "right-6 top-6",
  headerAside,
}: AppDialogShellProps): ReactNode {
  const isFixedSecondaryHeight = size === "workspace" || size === "responsive";

  return (
    <DialogContent
      chrome="bare"
      overlayClassName={overlayClassName}
      closeButtonClassName={closeButtonClassName}
      className={cn(
        "overflow-visible border-none bg-transparent p-0 shadow-none ",
        contentSizeClassName[size],
        isFixedSecondaryHeight && "h-[82vh]",
        dialogClassName
      )}
    >
      <div className={cn("p-1", isFixedSecondaryHeight && "h-full min-h-0 flex flex-col")}>
        <div
          className={cn(
            "glass-card repo-sidebar-shell flex min-h-0 flex-col overflow-hidden rounded-2xl",
            isFixedSecondaryHeight ? "h-full" : surfaceSizeClassName[size],
            surfaceClassName
          )}
        >
          <DialogHeader
            className={cn(
              "border-b border-border px-5 pb-4 pt-5 pr-14 sm:px-6 sm:pb-5 sm:pt-6 sm:pr-16",
              headerClassName
            )}
          >
            <div className="flex items-start gap-3">
              {icon ? (
                <span
                  className={cn(
                    "mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary ",
                    iconWrapperClassName
                  )}
                >
                  {icon}
                </span>
              ) : null}
              <div className="min-w-0 flex-1">
                <DialogTitle
                  className={cn("text-[18px] font-semibold tracking-tight", titleClassName)}
                >
                  {title}
                </DialogTitle>
                {description ? (
                  <DialogDescription
                    className={cn("mt-1 pr-2 leading-6", descriptionClassName)}
                  >
                    {description}
                  </DialogDescription>
                ) : null}
              </div>
              {headerAside ? <div className="flex-shrink-0">{headerAside}</div> : null}
            </div>
          </DialogHeader>

          <div
            className={cn(
              "min-h-0 flex-1",
              bodyScrollable ? "glass-scrollbar overflow-y-auto" : "relative overflow-hidden",
              bodyClassName
            )}
          >
            <div
              className={cn(
                !bodyScrollable && "absolute inset-0 h-full w-full flex flex-col",
                bodyScrollable && "min-h-0",
                bodyPadding === "default" && "p-5 sm:p-6",
                bodyInnerClassName
              )}
            >
              {children}
            </div>
          </div>

          {footer ? (
            <DialogFooter
              className={cn(
                "border-t border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-5",
                footerClassName
              )}
            >
              {footer}
            </DialogFooter>
          ) : null}
        </div>
      </div>
    </DialogContent>
  );
}
