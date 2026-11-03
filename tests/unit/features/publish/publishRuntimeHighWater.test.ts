import { beforeEach, describe, expect, it, vi } from "vitest";

const listeners = new Map<string, (evt: { payload: unknown }) => void>();

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name: string, cb: (evt: { payload: unknown }) => void) => {
    listeners.set(name, cb);
    return Promise.resolve(() => undefined);
  }),
}));

import {
  lastKnownSequenceFor,
  publishRuntimeScopeKey,
  resetPublishRuntimeHighWaterForTests,
  startPublishRuntimeEventTracking,
} from "@/features/publish/publishRuntimeHighWater";

function emit(payload: unknown): void {
  const cb = listeners.get("publish-runtime-event");
  expect(cb).toBeDefined();
  cb!({ payload });
}

function envelope(overrides: {
  repositoryPath?: string;
  configurationRevisionId?: string;
  sequence?: number;
  attemptId?: string;
}) {
  return {
    repositoryPath: overrides.repositoryPath ?? "/repo/a",
    configurationRevisionId: overrides.configurationRevisionId ?? "rev-1",
    event: {
      sequence: overrides.sequence ?? 1,
      attemptId: overrides.attemptId ?? "att-1",
      kind: "stage_started",
      occurredAtUnixMs: 0,
    },
  };
}

describe("publishRuntimeHighWater", () => {
  beforeEach(() => {
    localStorage.clear();
    listeners.clear();
    resetPublishRuntimeHighWaterForTests();
  });

  it("returns undefined before any observation", () => {
    expect(lastKnownSequenceFor("/repo/a", "rev-1")).toBeUndefined();
  });

  it("starts the listener idempotently and tracks max sequence", () => {
    startPublishRuntimeEventTracking();
    startPublishRuntimeEventTracking();
    expect(listeners.size).toBe(1);
    emit(envelope({ sequence: 3 }));
    emit(envelope({ sequence: 2 }));
    emit(envelope({ sequence: 7 }));
    expect(lastKnownSequenceFor("/repo/a", "rev-1")).toBe(7);
  });

  it("keeps scopes separate", () => {
    startPublishRuntimeEventTracking();
    emit(envelope({ sequence: 5 }));
    emit(
      envelope({
        repositoryPath: "/repo/b",
        sequence: 9,
        attemptId: "att-9",
      })
    );
    emit(
      envelope({
        configurationRevisionId: "rev-2",
        sequence: 4,
        attemptId: "att-8",
      })
    );
    expect(lastKnownSequenceFor("/repo/a", "rev-1")).toBe(5);
    expect(lastKnownSequenceFor("/repo/b", "rev-1")).toBe(9);
    expect(lastKnownSequenceFor("/repo/a", "rev-2")).toBe(4);
  });

  it("persists state and rehydrates across resets", () => {
    startPublishRuntimeEventTracking();
    emit(envelope({ sequence: 11 }));
    // simulate app restart: persisted snapshot survives the state reset
    const persisted = localStorage.getItem(
      "one-publish:publishRuntimeHighWater"
    );
    expect(persisted).toBeTruthy();
    resetPublishRuntimeHighWaterForTests();
    localStorage.setItem(
      "one-publish:publishRuntimeHighWater",
      persisted as string
    );
    expect(lastKnownSequenceFor("/repo/a", "rev-1")).toBe(11);
  });

  it("replaces the entry when a new attempt restarts at lower sequence", () => {
    startPublishRuntimeEventTracking();
    emit(envelope({ sequence: 42, attemptId: "att-old" }));
    emit(envelope({ sequence: 3, attemptId: "att-new" }));
    expect(lastKnownSequenceFor("/repo/a", "rev-1")).toBe(3);
    emit(envelope({ sequence: 8, attemptId: "att-new" }));
    expect(lastKnownSequenceFor("/repo/a", "rev-1")).toBe(8);
  });

  it("ignores stale events from a superseded attempt", () => {
    startPublishRuntimeEventTracking();
    emit(envelope({ sequence: 42, attemptId: "att-old" }));
    emit(envelope({ sequence: 3, attemptId: "att-new" }));
    emit(envelope({ sequence: 99, attemptId: "att-old" }));
    expect(lastKnownSequenceFor("/repo/a", "rev-1")).toBe(3);
  });

  it("ignores malformed payloads", () => {
    startPublishRuntimeEventTracking();
    emit(null);
    emit({ repositoryPath: "/repo/a" });
    emit({
      event: { sequence: "x" },
      repositoryPath: "/repo/a",
      configurationRevisionId: "rev-1",
    });
    expect(lastKnownSequenceFor("/repo/a", "rev-1")).toBeUndefined();
  });

  it("scope key joins path and revision", () => {
    expect(publishRuntimeScopeKey("/r", "v")).toBe("/r::v");
  });
});
