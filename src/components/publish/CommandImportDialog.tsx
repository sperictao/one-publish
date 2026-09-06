import { useState } from "react";
import { toast } from "sonner";

import { AppDialogShell } from "@/components/ui/app-dialog-shell";
import { AppDialogInset } from "@/components/ui/app-dialog-inset";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Terminal } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import {
  importFromCommand,
  type CommandImportResult,
} from "@/features/publish/publishRuntime";
import {
  resolveProviderCommandExample,
  resolveProviderLabel,
} from "@/features/provider/providers";
import type { ProviderManifest } from "@/lib/store/types";

interface CommandImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providerId: string;
  provider: ProviderManifest | null;
  projectPath: string;
  onImport: (result: CommandImportResult) => void;
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
  const [parsedResult, setParsedResult] = useState<CommandImportResult | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const { translations } = useI18n();
  const commandT = translations.commandImport || {};

  const commandExample = resolveProviderCommandExample(provider);
  const providerLabel = resolveProviderLabel(provider, providerId);

  const handleParse = async () => {
    if (!provider?.supportsCommandImport || isParsing) return;
    if (!command.trim()) {
      toast.error(commandT.enterCommand || "输入命令");
      return;
    }

    setIsParsing(true);
    setError(null);
    setParsedResult(null);

    try {
      const result = await importFromCommand({
        command,
        providerId,
        projectPath,
      });
      setParsedResult(result);
      toast.success(commandT.parseSuccess || "参数已导入");
    } catch (err) {
      const errorMsg = String(err);
      setError(errorMsg);
      toast.error(commandT.parseFailed || "解析失败", {
        description: errorMsg,
      });
    } finally {
      setIsParsing(false);
    }
  };

  const handleImport = () => {
    if (parsedResult) {
      onImport(parsedResult);
      handleClose();
    }
  };

  const handleClose = () => {
    setCommand("");
    setParsedResult(null);
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
        icon={<Terminal className="size-4" />}
        bodyInnerClassName="space-y-4"
        footer={
          <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={handleClose}>
              {commandT.cancel || "取消"}
            </Button>
            <Button
              onClick={handleImport}
              disabled={!parsedResult || isParsing}
            >
              {commandT.importParameters || "导入参数"}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <AppDialogInset className="space-y-3">
            <div className="space-y-1">
              <div className="text-label-12 font-semibold uppercase text-muted-foreground">
                {commandT.commandSectionTitle || "命令输入"}
              </div>
              <p className="text-label-12 text-muted-foreground">
                {(
                  commandT.currentProvider || "当前 Provider: {{provider}}"
                ).replace("{{provider}}", providerLabel)}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="command-input">
                {commandT.commandLabel || "构建命令"}
              </Label>
              <Textarea
                id="command-input"
                placeholder={
                  commandExample
                    ? `${commandT.examplePrefix || "示例"}: ${commandExample}`
                    : undefined
                }
                disabled={isParsing}
                value={command}
                onChange={(e) => {
                  setCommand(e.target.value);
                  setParsedResult(null);
                  setError(null);
                }}
                rows={4}
                className="font-mono text-copy-13-mono"
              />
            </div>
          </AppDialogInset>

          <Button
            onClick={handleParse}
            disabled={
              isParsing || !command.trim() || !provider?.supportsCommandImport
            }
            className="w-full"
          >
            {isParsing ? (
              <>
                <span className="inline-block animate-spin mr-2">
                  <Loader2 className="size-4" />
                </span>
                {commandT.parsing || "解析中…"}
              </>
            ) : (
              commandT.parseCommand || "解析命令"
            )}
          </Button>

          {error && (
            <AppDialogInset className="space-y-1 border-destructive/20 bg-destructive/5 text-destructive">
              <p className="text-label-14 font-semibold">
                {commandT.parseFailed || "解析失败"}
              </p>
              <p className="text-label-12">{error}</p>
            </AppDialogInset>
          )}

          {parsedResult && (
            <AppDialogInset className="space-y-2">
              <Label>{commandT.extractedParameters || "提取的参数"}</Label>
              <div className="rounded-sm bg-muted p-3">
                <pre className="font-mono text-copy-13-mono overflow-auto max-h-40">
                  {JSON.stringify(parsedResult.parameters, null, 2)}
                </pre>
              </div>
              {parsedResult.diagnostics.length > 0 && (
                <div className="status-cancelled rounded-sm px-3 py-2">
                  <p className="text-label-12 font-semibold">
                    {(commandT.diagnostics || "解析诊断") +
                      ` (${parsedResult.diagnostics.length})`}
                  </p>
                  <ul className="mt-1 space-y-1">
                    {parsedResult.diagnostics.map((diagnostic, index) => (
                      <li
                        key={`${diagnostic.code}-${index}`}
                        className="font-mono text-label-13-mono"
                      >
                        {diagnostic.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </AppDialogInset>
          )}
        </div>
      </AppDialogShell>
    </Dialog>
  );
}
