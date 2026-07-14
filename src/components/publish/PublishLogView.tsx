import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowDown, Copy } from "lucide-react";

import { classifyLogLine, type LogLineLevel } from "@/features/publish/classifyLogLine";
import { cn } from "@/lib/utils";

// 贴底容差（px）：滚动位置距底部小于此值即视为"跟随中"。
const AT_BOTTOM_THRESHOLD = 8;

const LEVEL_CLASS: Record<LogLineLevel, string> = {
  error: "text-red-500",
  warning: "text-amber-400",
  plain: "",
};

export interface PublishLogViewProps {
  /** 当前可见日志文本（可能被上限截断）。 */
  text: string;
  /** 复制时取用的完整日志（未截断）。 */
  getSnapshot: () => string;
  /** 运行中：新日志到来时自动跟随滚动到底部。 */
  active: boolean;
  copyLabel?: string;
  copiedLabel?: string;
  jumpLabel?: string;
  className?: string;
}

/**
 * 发布终端日志视图：逐行诊断着色、追加时自动跟随滚动、
 * 手动上滚暂停跟随并浮现"回到底部"按钮、一键复制完整日志。
 */
export function PublishLogView({
  text,
  getSnapshot,
  active,
  copyLabel = "复制日志",
  copiedLabel = "已复制日志",
  jumpLabel = "回到底部",
  className,
}: PublishLogViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  // 文本变化后，若处于跟随态则贴底。useLayoutEffect 避免可见跳动。
  useLayoutEffect(() => {
    if (followRef.current) {
      scrollToBottom();
    }
  }, [text, scrollToBottom]);

  // active 从 false→true（新一轮发布开始）时重置为跟随。
  useEffect(() => {
    if (active) {
      followRef.current = true;
      setShowJump(false);
      scrollToBottom();
    }
  }, [active, scrollToBottom]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < AT_BOTTOM_THRESHOLD;
    followRef.current = atBottom;
    setShowJump(!atBottom);
  }, []);

  const handleJump = useCallback(() => {
    followRef.current = true;
    setShowJump(false);
    scrollToBottom();
  }, [scrollToBottom]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(getSnapshot());
      toast.success(copiedLabel);
    } catch (err) {
      toast.error(String(err));
    }
  }, [getSnapshot, copiedLabel]);

  const lines = text.split("\n");

  return (
    <div className={cn("relative min-h-0 min-w-0 flex-1", className)}>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        role="log"
        aria-live={active ? "polite" : "off"}
        aria-relevant="additions"
        className="h-full min-w-0 overflow-auto rounded-sm bg-[hsl(var(--terminal-bg))] p-4 font-mono text-label-12-mono text-[hsl(var(--terminal-fg))]"
      >
        <pre className="min-w-0 whitespace-pre-wrap break-all [overflow-wrap:anywhere]">
          {lines.map((line, idx) => {
            const level = classifyLogLine(line);
            const cls = LEVEL_CLASS[level];
            return (
              <span key={idx} className={cls ? cn("block", cls) : "block"}>
                {line || " "}
              </span>
            );
          })}
        </pre>
      </div>

      <button
        type="button"
        onClick={handleCopy}
        aria-label={copyLabel}
        title={copyLabel}
        className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-md bg-gray-alpha-200 text-[hsl(var(--terminal-fg))] transition-colors duration-150 ease-geist hover:bg-gray-alpha-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive/40"
      >
        <Copy className="size-3.5" />
      </button>

      {showJump && (
        <button
          type="button"
          onClick={handleJump}
          className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-label-12 font-medium text-foreground shadow-sm animate-fade-in transition-colors duration-150 ease-geist hover:bg-gray-alpha-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive/40"
        >
          <ArrowDown className="size-3.5" />
          {jumpLabel}
        </button>
      )}
    </div>
  );
}
