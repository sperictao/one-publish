// ErrorBoundary - 应用级渲染错误边界
// 捕获子树渲染期/懒加载期异常，避免整个 webview 白屏；
// 展示本地化兜底文案与错误摘要，并提供重新加载入口。

import { Component, type ReactNode } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useI18n, type TranslationTree } from "@/hooks/useI18n";

interface ErrorBoundaryProps {
  /** `app` 翻译子树；翻译未加载时各文案回落内置中文。 */
  appT: TranslationTree;
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: toError(error) };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    console.error(
      "渲染错误边界捕获异常:",
      toError(error),
      info.componentStack ?? ""
    );
  }

  render() {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }

    const { appT } = this.props;
    const message = error.message || String(error);
    return (
      <div className="flex h-screen items-center justify-center bg-background px-6">
        <div className="flex w-full max-w-md flex-col items-center">
          <EmptyState
            icon={AlertTriangle}
            title={appT.errorBoundaryTitle || "界面渲染遇到问题"}
            hint={
              appT.errorBoundaryDescription ||
              "应用发生了未处理的界面异常。可以重新加载恢复，已保存的配置不会丢失。"
            }
            action={
              <Button
                variant="default"
                size="sm"
                onClick={() => window.location.reload()}
              >
                <RotateCw className="size-3.5" />
                {appT.errorBoundaryReload || "重新加载"}
              </Button>
            }
          />
          {message ? (
            <div className="mt-4 w-full rounded-md bg-muted/50 px-3 py-2">
              <p className="text-label-12 text-muted-foreground">
                {appT.errorBoundaryDetails || "错误详情"}
              </p>
              <p className="mt-1 break-all font-mono text-label-12 text-foreground/70">
                {message}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    );
  }
}

/**
 * 连接 i18n 的应用级边界。包一层函数组件以订阅语言切换，
 * 让兜底文案跟随当前语言。
 */
export function AppErrorBoundary({ children }: { children: ReactNode }) {
  const { translations } = useI18n();
  const appT = translations.app || {};
  return <ErrorBoundary appT={appT}>{children}</ErrorBoundary>;
}
