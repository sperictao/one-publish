import { AppDialogShell } from "@/components/ui/app-dialog-shell";
import { Dialog } from "@/components/ui/dialog";
import { Keyboard } from "lucide-react";
import { useEffect, useState } from "react";
import { getShortcutsHelp } from "@/lib/store/api";
import type { ShortcutHelp } from "@/lib/store/types";
import { useI18n } from "@/hooks/useI18n";

interface ShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShortcutsDialog({
  open,
  onOpenChange,
}: ShortcutsDialogProps) {
  const [shortcuts, setShortcuts] = useState<ShortcutHelp[]>([]);
  const { translations } = useI18n();
  const shortcutT = translations.shortcuts || {};

  useEffect(() => {
    if (open) {
      getShortcutsHelp()
        .then(setShortcuts)
        .catch(console.error);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AppDialogShell
        size="compact"
        title={shortcutT.title || "快捷键"}
        description={shortcutT.description || "可用的全局快捷键"}
        icon={<Keyboard className="size-4" />}
        bodyInnerClassName="space-y-2"
      >
        <div className="space-y-2">
          {shortcuts.map((shortcut) => (
            <div
              key={`${shortcut.key}:${shortcut.description}`}
              className="flex items-center justify-between p-3 surface-input rounded-md"
            >
              <span className="text-sm">{shortcut.description}</span>
              <kbd className="px-2 py-1 text-xs font-semibold bg-muted border border-border rounded-sm">
                {shortcut.key}
              </kbd>
            </div>
          ))}
          {shortcuts.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              {shortcutT.empty || "暂无快捷键"}
            </p>
          )}
        </div>
      </AppDialogShell>
    </Dialog>
  );
}
