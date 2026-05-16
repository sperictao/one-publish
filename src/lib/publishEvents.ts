/**
 * 发布生命周期事件类型定义。
 *
 * 事件由 usePublishExecute 发出，由 usePublishNotify 订阅处理。
 */

import type { ExecutionRecord } from "@/lib/store";

/** 发布已提交，即将开始执行。 */
export interface PublishStartedEvent {
  repoId: string | null;
  providerId: string;
}

/** 发布成功完成。 */
export interface PublishCompletedEvent {
  repoId: string | null;
  outputDir: string;
  outputLog: string;
  shouldOpenOutputDir: boolean;
  feedbackMode: "toast" | "system";
  trayStatusEffect: boolean;
  restoreWindowOnFailure: boolean;
  record: ExecutionRecord;
}

/** 发布失败。 */
export interface PublishFailedEvent {
  repoId: string | null;
  error: string;
  outputLog: string;
  feedbackTitle: string;
  feedbackDescription: string;
  feedbackMode: "toast" | "system";
  trayStatusEffect: boolean;
  restoreWindowOnFailure: boolean;
  record: ExecutionRecord;
}

/** 发布被取消。 */
export interface PublishCancelledEvent {
  repoId: string | null;
  error: string;
  outputLog: string;
  feedbackMode: "toast" | "system";
  trayStatusEffect: boolean;
  restoreWindowOnFailure: boolean;
  record: ExecutionRecord;
}

/** 所有发布事件的联合类型。 */
export type PublishEvent =
  | { type: "publish:started"; payload: PublishStartedEvent }
  | { type: "publish:completed"; payload: PublishCompletedEvent }
  | { type: "publish:failed"; payload: PublishFailedEvent }
  | { type: "publish:cancelled"; payload: PublishCancelledEvent };

export const PublishEventType = {
  STARTED: "publish:started",
  COMPLETED: "publish:completed",
  FAILED: "publish:failed",
  CANCELLED: "publish:cancelled",
} as const;
