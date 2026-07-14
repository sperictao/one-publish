import { describe, expect, it } from "vitest";

import { formatElapsed } from "@/features/publish/useElapsedTimer";

describe("formatElapsed", () => {
  it("格式化为 mm:ss", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(5_000)).toBe("00:05");
    expect(formatElapsed(65_000)).toBe("01:05");
    expect(formatElapsed(600_000)).toBe("10:00");
  });

  it("负值与不足一秒归零", () => {
    expect(formatElapsed(-100)).toBe("00:00");
    expect(formatElapsed(999)).toBe("00:00");
  });
});
