import { AppDialogShell } from "@/components/ui/app-dialog-shell";
import { Dialog } from "@/components/ui/dialog";
import { Keyboard } from "lucide-react";
import { isMacPlatform } from "@/lib/platform";
import { useI18n } from "@/hooks/useI18n";

interface ShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShortcutsDialog({ open, onOpenChange }: ShortcutsDialogProps) {
  const { translations } = useI18n();
  const shortcutT = translations.shortcuts || {};
  const modifier = isMacPlatform() ? "⌘" : "Ctrl";
  const shortcuts = [
    { key: `${modifier} R`, description: shortcutT.refresh || "刷新项目" },
    { key: `${modifier} P`, description: shortcutT.publish || "执行发布" },
    { key: `${modifier} ,`, description: shortcutT.settings || "打开设置" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AppDialogShell
        size="compact"
        title={shortcutT.title || "快捷键"}
        description={shortcutT.description || "应用窗口内可用的快捷键"}
        icon={<Keyboard className="size-4" />}
        bodyInnerClassName="space-y-2"
      >
        <div className="space-y-2">
          {shortcuts.map((shortcut) => (
            <div
              key={`${shortcut.key}:${shortcut.description}`}
              className="flex items-center justify-between p-3 surface-input rounded-sm"
            >
              <span className="text-label-14">{shortcut.description}</span>
              <kbd className="px-2 py-1 text-label-12 font-semibold bg-muted border border-border rounded-sm">
                {shortcut.key}
              </kbd>
            </div>
          ))}
        </div>
      </AppDialogShell>
    </Dialog>
  );
}
