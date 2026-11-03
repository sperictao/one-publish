import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { PublishRuntimeEventEnvelope } from "@/generated/tauri-contracts";

// 前端观测高水位（#360）：publish-runtime-event 在 Journal 落盘前广播，
// 前端记录的是「已观测」而非「已持久化」的序号。synchronize 请求把它作为
// lastKnownSequence 回传，让 Journal 能检出落盘前丢失的尾段。
const STORAGE_KEY = "one-publish:publishRuntimeHighWater";
const MAX_TRACKED_SCOPES = 32;
const CHANNEL = "publish-runtime-event";

type ScopeHighWater = { attemptId: string; maxSeq: number; touched: number };
type PersistedState = { v: 1; scopes: Record<string, ScopeHighWater> };

const scopes = new Map<string, ScopeHighWater>();
let hydrated = false;
let listenerStarted = false;

function hydrate(): void {
  if (hydrated) {
    return;
  }
  hydrated = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }
    const parsed = JSON.parse(raw) as PersistedState;
    if (parsed?.v !== 1 || typeof parsed.scopes !== "object") {
      return;
    }
    for (const [key, value] of Object.entries(parsed.scopes)) {
      if (
        value &&
        typeof value.attemptId === "string" &&
        typeof value.maxSeq === "number"
      ) {
        scopes.set(key, value);
      }
    }
  } catch {
    // 损坏或不可用的持久化只意味着声明更保守，不影响正确性。
  }
}

function persist(): void {
  try {
    // LRU：按 touched 淘汰最旧的 scope，地图规模有界。
    while (scopes.size > MAX_TRACKED_SCOPES) {
      let oldestKey: string | null = null;
      let oldestTouched = Infinity;
      for (const [key, value] of scopes) {
        if (value.touched < oldestTouched) {
          oldestTouched = value.touched;
          oldestKey = key;
        }
      }
      if (!oldestKey) {
        break;
      }
      scopes.delete(oldestKey);
    }
    const state: PersistedState = {
      v: 1,
      scopes: Object.fromEntries(scopes),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 持久化失败同样只使声明保守化。
  }
}

export function publishRuntimeScopeKey(
  repositoryPath: string,
  configurationRevisionId: string
): string {
  return `${repositoryPath}::${configurationRevisionId}`;
}

/** 某发布 scope 已观测到的高水位序号；未观测过时返回 undefined。 */
export function lastKnownSequenceFor(
  repositoryPath: string,
  configurationRevisionId: string
): number | undefined {
  hydrate();
  return scopes.get(
    publishRuntimeScopeKey(repositoryPath, configurationRevisionId)
  )?.maxSeq;
}

/** 幂等启动事件订阅；非 Tauri 环境（测试/纯 Web）为空操作。 */
export function startPublishRuntimeEventTracking(): void {
  if (listenerStarted || !isTauri()) {
    return;
  }
  listenerStarted = true;
  hydrate();
  void listen<PublishRuntimeEventEnvelope>(CHANNEL, ({ payload }) => {
    if (!payload?.event || typeof payload.event.sequence !== "number") {
      return;
    }
    const key = publishRuntimeScopeKey(
      payload.repositoryPath,
      payload.configurationRevisionId
    );
    const current = scopes.get(key);
    const nextSeq = payload.event.sequence;
    if (current && current.attemptId !== payload.event.attemptId) {
      // scope 串行：新 Attempt 序号从 1 重计。晚到的旧 Attempt 事件
      // （seq 高于新水位）是被取代的残留观测，不得回写。
      if (nextSeq > current.maxSeq) {
        return;
      }
    } else if (current && nextSeq <= current.maxSeq) {
      return;
    }
    scopes.set(key, {
      attemptId: payload.event.attemptId,
      maxSeq: nextSeq,
      touched: Date.now(),
    });
    persist();
  });
}

/** 测试辅助：清空观测状态并允许重新启动 listener。 */
export function resetPublishRuntimeHighWaterForTests(): void {
  scopes.clear();
  hydrated = false;
  listenerStarted = false;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
