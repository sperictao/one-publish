import { describe, expect, it } from "vitest";

import { getCancelPublishFeedback } from "@/features/publish/cancelPublishFeedback";

describe("getCancelPublishFeedback", () => {
  it("uses the dedicated cancel-failure copy for publish_cancel_failed", () => {
    const feedback = getCancelPublishFeedback(
      {},
      "publish_cancel_failed",
      "raw backend message"
    );

    expect(feedback.title).toBe("取消发布失败");
    expect(feedback.description).toContain("取消发送失败");
    expect(feedback.description).not.toBe("raw backend message");
  });

  it("surfaces the backend message for other error codes", () => {
    const feedback = getCancelPublishFeedback(
      {},
      "some_other_error",
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
      "publish_cancel_failed",
      "raw"
    );

    expect(feedback).toEqual({
      title: "Cancel failed",
      description: "Could not send the cancel request.",
    });
  });
});
