import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

import { AppDialogShell } from "@/components/ui/app-dialog-shell";
import { AppDialogInset } from "@/components/ui/app-dialog-inset";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Terminal } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import type { ProviderPublishSpec } from "@/hooks/usePublishRunner";
import { resolveProviderCommandExample, resolveProviderLabel } from "@/lib/providers";
import type { ProviderManifest } from "@/lib/store";

interface CommandImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providerId: string;
  provider: ProviderManifest | null;
  projectPath: string;
  onImport: (spec: ProviderPublishSpec) => void;
}

export function CommandImportDialog({
  open,
  onOpenChange,
  providerId,
  provider,
  projectPath,
  onImport,
}: CommandImportDialogProps) {
  const [command, setCommand] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [parsedSpec, setParsedSpec] = useState<ProviderPublishSpec | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { translations } = useI18n();
  const commandT = translations.commandImport || {};

  const commandExample = resolveProviderCommandExample(provider);
  const providerLabel = resolveProviderLabel(provider, providerId);

  const handleParse = async () => {
    if (!command.trim()) {
      toast.error(commandT.enterCommand || "请输入命令");
      return;
    }

    setIsParsing(true);
    setError(null);
    setParsedSpec(null);

    try {
      const spec = await invoke<ProviderPublishSpec>("import_from_command", {
        command,
        providerId,
        projectPath,
      });
      setParsedSpec(spec);
      toast.success(commandT.parseSuccess || "命令解析成功");
    } catch (err) {
      const errorMsg = String(err);
      setError(errorMsg);
      toast.error(commandT.parseFailed || "解析失败", { description: errorMsg });
    } finally {
      setIsParsing(false);
    }
  };

  const handleImport = () => {
    if (parsedSpec) {
      onImport(parsedSpec);
      handleClose();
    }
  };

  const handleClose = () => {
    setCommand("");
    setParsedSpec(null);
    setError(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AppDialogShell
        size="compact"
        dialogClassName="sm:max-w-[640px]"
        title={commandT.title || "从命令导入"}
        description={commandT.description || "粘贴你的构建命令，自动提取参数"}
        icon={<Terminal className="h-4 w-4" />}
        bodyInnerClassName="space-y-4"
        footer={
          <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={handleClose}>
              {commandT.cancel || "取消"}
            </Button>
            <Button onClick={handleImport} disabled={!parsedSpec}>
              {commandT.importParameters || "导入参数"}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <AppDialogInset className="space-y-3">
            <div className="space-y-1">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">
                {commandT.commandSectionTitle || "命令输入"}
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                {(commandT.currentProvider ||
                  "当前 Provider: {{provider}}（支持: dotnet, cargo, go, gradle）").replace(
                  "{{provider}}",
                  providerLabel
                )}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="command-input">{commandT.commandLabel || "构建命令"}</Label>
              <Textarea
                id="command-input"
                placeholder={
                  commandExample
                    ? `${commandT.examplePrefix || "示例"}: ${commandExample}`
                    : undefined
                }
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                rows={4}
                className="font-mono text-sm"
              />
            </div>
          </AppDialogInset>

          <Button
            onClick={handleParse}
            disabled={isParsing || !command.trim()}
            className="w-full"
          >
            {isParsing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {commandT.parsing || "解析中..."}
              </>
            ) : (
              commandT.parseCommand || "解析命令"
            )}
          </Button>

          {error && (
            <AppDialogInset className="space-y-1 border-destructive/20 bg-destructive/8 text-destructive shadow-none">
              <p className="font-semibold">{commandT.parseFailed || "解析失败"}</p>
              <p className="text-xs">{error}</p>
            </AppDialogInset>
          )}

          {parsedSpec && (
            <AppDialogInset className="space-y-2">
              <Label>{commandT.extractedParameters || "提取的参数"}</Label>
              <div className="rounded-xl bg-background/60 p-3">
                <pre className="text-xs font-mono overflow-auto max-h-40">
                  {JSON.stringify(parsedSpec.parameters, null, 2)}
                </pre>
              </div>
            </AppDialogInset>
          )}
        </div>
      </AppDialogShell>
    </Dialog>
  );
}
