import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ExecutionRecord } from "@/lib/store/types";

import { useRerunFlow } from "@/hooks/useRerunFlow";

const digest = "a".repeat(64);

const record = (overrides: Partial<ExecutionRecord>) =>
  ({
    id: "record-1",
    repoId: "repo-a",
    manifestDigest: digest,
    ...overrides,
  }) as ExecutionRecord;

describe("useRerunFlow", () => {
  it("rerunFromHistory 只携带 history 来源，不带 digest", async () => {
    const runPublishSpec = vi.fn();
    const { result } = renderHook(() => useRerunFlow({ runPublishSpec }));

    await result.current.rerunFromHistory(record({}));

    expect(runPublishSpec).toHaveBeenCalledWith({
      kind: "history",
      recordId: "record-1",
    });
  });

  it("promoteFromHistory 复用 history 来源并注入 digest 与 repoId", async () => {
    const runPublishSpec = vi.fn();
    const { result } = renderHook(() => useRerunFlow({ runPublishSpec }));

    await result.current.promoteFromHistory(record({}));

    expect(runPublishSpec).toHaveBeenCalledWith(
      { kind: "history", recordId: "record-1" },
      { promotedManifestDigest: digest, repoId: "repo-a" }
    );
  });

  it("promoteFromHistory 跳过无 manifestDigest 的记录", async () => {
    const runPublishSpec = vi.fn();
    const { result } = renderHook(() => useRerunFlow({ runPublishSpec }));

    await result.current.promoteFromHistory(
      record({ manifestDigest: undefined })
    );

    expect(runPublishSpec).not.toHaveBeenCalled();
  });
});
