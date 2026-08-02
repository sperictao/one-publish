import { Loader2, RefreshCw, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { RemoteAttemptEvidenceView } from "@/lib/automationBindings";

export function remoteStatusLabel(
  status: string,
  t: Record<string, string | undefined>
): string {
  switch (status) {
    case "published":
      return t.automationRemotePublished || "已发布";
    case "partial_delivery":
      return t.automationRemotePartial || "部分交付";
    case "failed":
      return t.automationRemoteFailed || "失败";
    case "cancelled":
      return t.automationRemoteCancelled || "已取消";
    default:
      return t.automationRemoteRunning || "进行中";
  }
}

export interface RemoteEvidenceSectionProps {
  evidence: RemoteAttemptEvidenceView[] | null;
  syncing: boolean;
  cancellingRunId: number | null;
  onSync: () => void;
  onCancelRun: (attempt: RemoteAttemptEvidenceView) => void;
  t: Record<string, string | undefined>;
}

/**
 * 远端发布证据独立区块：同步、展示归档证据，并对进行中的远端运行提供取消。
 * 数据与动作由父组件持有，本组件只做呈现。
 */
export function RemoteEvidenceSection({
  evidence,
  syncing,
  cancellingRunId,
  onSync,
  onCancelRun,
  t,
}: RemoteEvidenceSectionProps) {
  return (
    <div className="mt-3" data-testid="automation-remote-evidence">
      <div className="flex items-center justify-between">
        <span className="text-label-12 font-medium text-muted-foreground">
          {t.automationRemoteEvidence || "远端发布记录"}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-label-12"
          onClick={onSync}
          disabled={syncing}
        >
          {syncing ? (
            <Loader2 className="mr-1 size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="mr-1 size-3.5" />
          )}
          {t.automationRemoteSync || "同步远端证据"}
        </Button>
      </div>
      {evidence === null ? (
        <p className="mt-1 text-label-12 text-muted-foreground">
          {t.automationRemoteHint || "同步后展示远端发布的归档证据。"}
        </p>
      ) : evidence.length === 0 ? (
        <p className="mt-1 text-label-12 text-muted-foreground">
          {t.automationRemoteEmpty || "尚无远端发布记录"}
        </p>
      ) : (
        <ul className="mt-1 space-y-1">
          {evidence.map((attempt) => {
            const isRunning =
              attempt.state.kind === "archived" &&
              attempt.state.status === "running";
            return (
              <li
                key={attempt.attemptId}
                className="flex items-center justify-between gap-2 rounded-sm border border-border px-2 py-1"
                data-testid={`automation-remote-attempt-${attempt.attemptId}`}
              >
                <span className="truncate text-label-12 text-foreground">
                  {attempt.attemptId}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  {attempt.state.kind === "archived" ? (
                    <span
                      className={
                        attempt.state.status === "published"
                          ? "rounded-sm bg-success/10 px-1.5 py-0.5 text-label-12 font-medium text-success"
                          : "rounded-sm bg-muted px-1.5 py-0.5 text-label-12 font-medium text-muted-foreground"
                      }
                      title={attempt.state.error ?? undefined}
                    >
                      {remoteStatusLabel(attempt.state.status, t)}
                    </span>
                  ) : attempt.state.kind === "expired" ? (
                    <span
                      className="rounded-sm bg-red-500/15 px-1.5 py-0.5 text-label-12 font-medium text-red-700 dark:text-red-400"
                      data-testid={`automation-remote-expired-${attempt.attemptId}`}
                    >
                      {t.automationRemoteExpired || "远端证据已过期"}
                    </span>
                  ) : (
                    <span className="rounded-sm bg-amber-500/15 px-1.5 py-0.5 text-label-12 font-medium text-amber-700 dark:text-amber-400">
                      {(t.automationRemoteMissing || "证据缺失") +
                        ": " +
                        attempt.state.missing.join(", ")}
                    </span>
                  )}
                  {isRunning ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-1.5 text-label-12 text-red-700 hover:text-red-700 dark:text-red-400"
                      disabled={cancellingRunId !== null}
                      onClick={() => onCancelRun(attempt)}
                      data-testid={`automation-remote-cancel-${attempt.attemptId}`}
                    >
                      {cancellingRunId === attempt.runId ? (
                        <Loader2 className="mr-1 size-3 animate-spin" />
                      ) : (
                        <XCircle className="mr-1 size-3" />
                      )}
                      {t.automationRemoteCancelRun || "取消运行"}
                    </Button>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
