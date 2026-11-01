import { describe, expect, it } from "vitest";

import { getCancelPublishFeedback } from "@/features/publish/cancelPublishFeedback";

describe("getCancelPublishFeedback", () => {
  it("uses the dedicated cancel-failure copy for backend infra error codes", () => {
    for (const code of [
      "publish_runtime_cancellation_poisoned",
      "publish_runtime_attempt_operation_poisoned",
      "publish_runtime_error",
    ]) {
      const feedback = getCancelPublishFeedback(
        {},
        code,
        "raw backend message"
      );

      expect(feedback.title).toBe("取消发布失败");
      expect(feedback.description).toContain("取消发送失败");
      expect(feedback.description).not.toBe("raw backend message");
    }
  });

  it("surfaces the backend message for semantic error codes", () => {
    const feedback = getCancelPublishFeedback(
      {},
      "publish_runtime_cancellation_selector_invalid",
      "backend detail"
    );

    expect(feedback.description).toBe("backend detail");
  });

  it("prefers translations over built-in copy", () => {
    const feedback = getCancelPublishFeedback(
      {
        cancelPublishFailed: "Cancel failed",
        cancelPublishFailedDesc: "Could not send the cancel request.",
      },
      "publish_runtime_error",
      "raw"
    );

    expect(feedback).toEqual({
      title: "Cancel failed",
      description: "Could not send the cancel request.",
    });
  });
});
