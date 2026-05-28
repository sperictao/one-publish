import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

interface ProviderRuntimeBannerProps {
  title: string;
  description: string;
  status: "loading" | "error";
  retryLabel: string;
  onRetry: () => void;
}

export function ProviderRuntimeBanner({
  title,
  description,
  status,
  retryLabel,
  onRetry,
}: ProviderRuntimeBannerProps) {
  const isLoading = status === "loading";

  return (
    <div className="border-b border-border/60 bg-amber-50/70 px-4 py-3 text-foreground dark:bg-amber-500/8">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2 text-sm font-medium">
            {isLoading ? (
              <Loader2 className="size-4 animate-spin text-amber-600" />
            ) : (
              <AlertTriangle className="size-4 text-amber-600" />
            )}
            <span>{title}</span>
          </div>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRetry}
          disabled={isLoading}
          className="min-w-[112px]"
        >
          <RefreshCw className="mr-2 size-4" />
          {retryLabel}
        </Button>
      </div>
    </div>
  );
}
