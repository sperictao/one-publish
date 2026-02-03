import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Terminal } from "lucide-react";

interface CommandImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providerId: string;
  projectPath: string;
  onImport: (spec: any) => void;
}

export function CommandImportDialog({
  open,
  onOpenChange,
  providerId,
  projectPath,
  onImport,
}: CommandImportDialogProps) {
  const [command, setCommand] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [parsedSpec, setParsedSpec] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleParse = async () => {
    if (!command.trim()) {
      toast.error("请输入命令");
      return;
    }

    setIsParsing(true);
    setError(null);
    setParsedSpec(null);

    try {
      const spec = await invoke("import_from_command", {
        command,
        providerId,
        projectPath,
      });
      setParsedSpec(spec);
      toast.success("命令解析成功");
    } catch (err) {
      const errorMsg = String(err);
      setError(errorMsg);
      toast.error("解析失败", { description: errorMsg });
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
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Terminal className="h-5 w-5" />
            从命令导入
          </DialogTitle>
          <DialogDescription>
            粘贴你的构建命令，自动提取参数
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="command-input">构建命令</Label>
            <Textarea
              id="command-input"
              placeholder={`示例: dotnet publish MyProject.csproj -c Release -r win-x64 --self-contained`}
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              rows={4}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              支持的构建工具: dotnet, cargo, go, gradle
            </p>
          </div>

          <Button
            onClick={handleParse}
            disabled={isParsing || !command.trim()}
            className="w-full"
          >
            {isParsing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                解析中...
              </>
            ) : (
              "解析命令"
            )}
          </Button>

          {error && (
            <div className="p-3 bg-destructive/10 text-destructive rounded-lg text-sm">
              <p className="font-semibold mb-1">解析失败</p>
              <p className="text-xs">{error}</p>
            </div>
          )}

          {parsedSpec && (
            <div className="space-y-2">
              <Label>提取的参数</Label>
              <div className="p-3 bg-muted rounded-lg">
                <pre className="text-xs font-mono overflow-auto max-h-40">
                  {JSON.stringify(parsedSpec.parameters, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            取消
          </Button>
          <Button onClick={handleImport} disabled={!parsedSpec}>
            导入参数
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
