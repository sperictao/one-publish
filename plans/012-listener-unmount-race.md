# Plan 012: 修复 Tauri 事件监听的卸载竞态（listen-then-assign 泄漏）

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 97d3d0c..HEAD -- src/features/publish/usePublishLogStream.ts src/hooks/useAppUpdater.ts`
> If either file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `97d3d0c`, 2026-07-14

## Why this matters

两个 hook 用了这样的模式注册 Tauri 事件监听：

```ts
let unlisten: (() => void) | null = null;
listen(...).then((dispose) => { unlisten = dispose; });
return () => { if (unlisten) unlisten(); };
```

竞态：若 effect 在 `listen()` 的 Promise 解析**之前**被清理（组件卸载、或
StrictMode 下的双执行），cleanup 读到的 `unlisten` 还是 `null`，什么也不做；
随后 Promise 解析、监听器注册成功，但已无人持有 dispose——**监听器永久泄漏**，
回调继续携带已卸载组件的闭包执行。这两个 hook 目前都是应用级单次挂载，实际
触发概率低，但 React 18 StrictMode（开发模式 effect 双执行）会稳定触发一次
泄漏，且该模式会被复制到未来的组件级 hook 中。仓库里已有正确写法
（`useShortcuts.ts` 的 `disposed` 标志），本计划把两处竞态改成同一模式。

## Current state

- `src/features/publish/usePublishLogStream.ts:75-116` — 发布日志流监听。
  现状（缩略）：

```ts
useEffect(() => {
    if (!isTauri()) {
      return;
    }

    let unlisten: (() => void) | null = null;

    listen<PublishLogChunkEvent>("provider-publish-log", (event) => {
      // ... 日志追加逻辑（保持不动）
    })
      .then((dispose) => {
        unlisten = dispose;
      })
      .catch((err) => {
        console.error("监听发布日志失败:", err);
      });

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [appendOutputLog]);
```

- `src/hooks/useAppUpdater.ts:127-165` — 更新下载进度监听（effect 内
  `let unlisten: (() => void) | null = null;` 在 127 行），同样的
  `.then((dispose) => { unlisten = dispose; })` + `if (unlisten) unlisten()`
  结构，`catch` 打印 `"监听更新下载进度失败:"`。
- **仓库内的正确范例**（照此模式改）：`src/hooks/useShortcuts.ts:38-67` ——
  用 `disposed` 标志，Promise 解析后若已 disposed 则立即调用 dispose：

```ts
let disposed = false;
const unlisteners: Array<() => void> = [];

const registerListeners = async () => {
  try {
    const registered = await Promise.all(...);
    if (disposed) {
      registered.forEach((unlisten) => unlisten());
      return;
    }
    unlisteners.push(...registered);
  } catch (error) { ... }
};

void registerListeners();

return () => {
  disposed = true;
  unlisteners.forEach((unlisten) => unlisten());
};
```

- 另一个已正确的文件：`src/hooks/useTrayRecentPublish.ts:200-236` 也用了
  `disposed` 标志。**这两个文件不要动。**

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck | `pnpm typecheck` | exit 0 |
| 相关单测 | `pnpm test -- usePublishRunner` | all pass |
| 全量单测 | `pnpm test` | all pass |

## Scope

**In scope**:
- `src/features/publish/usePublishLogStream.ts`（仅该 useEffect 的注册/清理骨架）
- `src/hooks/useAppUpdater.ts`（仅对应 useEffect 的注册/清理骨架）
- 若相关测试文件需要补竞态用例：`src/features/publish/__tests__/` 或
  `src/hooks/__tests__/` 下的对应测试文件（新增用例，不改既有用例）

**Out of scope** (do NOT touch):
- 两个 effect 内的**事件处理回调逻辑本身**（日志追加、进度 setState）——
  只改注册/清理骨架。
- `src/hooks/useShortcuts.ts`、`src/hooks/useTrayRecentPublish.ts` — 已是正确模式。
- 不要引入新的抽象（如通用 `useTauriListen` hook）——只有 2 个调用点，
  抽象留待第 3 个出现时再说。

## Git workflow

- Branch: `advisor/012-listener-unmount-race`
- Commit 建议：`fix(hooks): 修复 Tauri 事件监听在卸载竞态下的泄漏`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: 改 `usePublishLogStream.ts`

把 effect 的注册/清理骨架改为 `disposed` 标志模式（回调体原样保留）：

```ts
useEffect(() => {
    if (!isTauri()) {
      return;
    }

    let disposed = false;
    let unlisten: (() => void) | null = null;

    listen<PublishLogChunkEvent>("provider-publish-log", (event) => {
      // ...原回调体，一字不改
    })
      .then((dispose) => {
        if (disposed) {
          dispose();
          return;
        }
        unlisten = dispose;
      })
      .catch((err) => {
        console.error("监听发布日志失败:", err);
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [appendOutputLog]);
```

**Verify**: `pnpm typecheck` → exit 0。

### Step 2: 改 `useAppUpdater.ts`

对 127–165 行的 effect 做完全相同的骨架改造（`disposed` 标志 + then 内
`if (disposed) { dispose(); return; }`），回调体与 catch 消息保持原样。

**Verify**: `pnpm typecheck` → exit 0。

### Step 3: 补竞态回归测试（如可行）

在对应测试文件中新增一个用例：mock `@tauri-apps/api/event` 的 `listen` 返回
一个**手动控制解析时机**的 Promise；渲染 hook → 立即 unmount → 再 resolve
Promise（返回 vi.fn() 作为 dispose）→ 断言 dispose 被调用了一次。既有测试
中 mock listen 的写法可参考 `src/hooks/__tests__/useTrayRecentPublish.test.ts`
（该文件测的正是同类监听 hook）。

若现有测试基建让"延迟解析 listen"难以插入（例如 listen 被更高层的 setup
统一 mock 且不可注入），允许降级：跳过新增用例，在执行报告中说明原因——
此时 Step 1/2 的改动仍然成立，由 typecheck + 既有测试守护。

**Verify**: `pnpm test` → all pass（含新增用例，或报告中说明豁免理由）。

## Test plan

- 新增（每个被改 hook 各一条，见 Step 3）：
  1. unmount 先于 listen 解析 → 解析后 dispose 立即被调用（不泄漏）。
- 结构范例：`src/hooks/__tests__/useTrayRecentPublish.test.ts`。
- 回归：`pnpm test` 全绿，尤其 `usePublishRunner.test.ts`（1132 行，覆盖发布
  流程，是日志流 hook 的间接消费者）。

## Done criteria

Machine-checkable. ALL must hold:

- [ ] 两个文件的 effect 均含 `disposed` 标志，且 `.then` 内有
      `if (disposed) { dispose(); return; }` 分支
- [ ] 事件回调体无 diff（`git diff` 中回调内部行未变化）
- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` all pass
- [ ] 新增竞态用例存在并通过，或执行报告说明了豁免理由
- [ ] `git status` 改动仅限 In scope 文件（及 plans/README.md 状态行）
- [ ] `plans/README.md` 状态行已更新

## STOP conditions

Stop and report back (do not improvise) if:

- 两个文件中 effect 的现状与摘录不符（已漂移）。
- 你发现除这两处外还有第三处 `listen(...).then(dispose => unlisten = dispose)`
  竞态模式——报告位置，不要擅自扩大改动面（planned-at 时通过
  `grep -rn "let unlisten" src` 确认仅此两处 + 两个已正确文件）。
- 改动后任何既有测试失败。

## Maintenance notes

- 若未来出现第 3 个同类监听 hook，届时值得抽一个 `useTauriListen(event, handler)`
  通用 hook 统一封装 disposed 语义——本计划刻意不做（YAGNI）。
- Plan 010 引入的 ESLint 若后续启用 type-aware `no-floating-promises`，会对
  这类 `listen(...)` 调用链提出显式处理要求，与本修复方向一致。
- Reviewer 重点看：回调体是否真的零改动；cleanup 是否先置 `disposed = true`
  再调用 `unlisten`。
