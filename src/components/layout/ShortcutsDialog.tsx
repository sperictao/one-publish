import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Keyboard } from "lucide-react";
import { useEffect, useState } from "react";
import { getShortcutsHelp } from "@/lib/store";
import type { ShortcutHelp } from "@/lib/store";

interface ShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShortcutsDialog({
  open,
  onOpenChange,
}: ShortcutsDialogProps) {
  const [shortcuts, setShortcuts] = useState<ShortcutHelp[]>([]);

  useEffect(() => {
    if (open) {
      getShortcutsHelp()
        .then(setShortcuts)
        .catch(console.error);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-5 w-5" />
            快捷键
          </DialogTitle>
          <DialogDescription>
            可用的全局快捷键
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-4">
          {shortcuts.map((shortcut, index) => (
            <div
              key={index}
              className="flex items-center justify-between p-3 bg-muted rounded-lg"
            >
              <span className="text-sm">{shortcut.description}</span>
              <kbd className="px-2 py-1 text-xs font-semibold text-gray-800 bg-gray-100 border border-gray-300 rounded dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600">
                {shortcut.key}
              </kbd>
            </div>
          ))}
          {shortcuts.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              暂无快捷键
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
