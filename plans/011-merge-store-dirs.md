# Plan 011: 消除 `src/store` 与 `src/stores` 双目录混淆

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 97d3d0c..HEAD -- src/store src/stores src/features/publish/usePublishExecute.ts src/hooks/useAppBoot.ts`
> If any of these changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `97d3d0c`, 2026-07-14

## Why this matters

仓库同时存在 `src/store/`（仅一个文件 `publishStore.ts`，45 行，存放发布
运行时的**临时 UI 状态**：isPublishing、publishResult 等）与 `src/stores/`
（8 个文件的 slice 体系，挂在 `appStore` 上，负责**持久化**的应用状态）。
两个目录名只差一个 `s`，新代码极易 import 错位置，也让人误以为存在重复实现。

审计核实结论（执行者需要知道，避免走错方向）：`publishStore` 与
`src/stores/publishStateSlice.ts` **功能不重叠**——前者是发布会话的临时状态，
后者是最近发布配置的持久化（带防抖写盘）。所以正确的修复**不是合并两个
store**，而是把 `publishStore.ts` 移入 `src/stores/`，删除 `src/store/` 目录，
让所有 Zustand store 住在同一个目录下。这是纯机械搬移 + import 更新。

## Current state

- `src/store/publishStore.ts` — 整个 `src/store/` 目录的唯一文件。独立的
  Zustand store（`create<PublishStore>`），字段：`isPublishing`、
  `isCancellingPublish`、`publishResult`、`lastPublishSpec`、
  `currentPublishRecordId`、`releaseChecklistOpen`、`artifactActionState`
  及对应 setter。开头（现状摘录）：

```ts
import { create } from "zustand";

import type { ArtifactActionState } from "@/components/publish/ArtifactActions";
import type {
  ProviderPublishSpec,
  PublishResult,
} from "@/features/publish/publishRuntime";

interface PublishStore {
```

- 引用方（全部，通过 `grep -rln 'store/publishStore' src` 核实）：
  - `src/features/publish/usePublishExecute.ts:8` —
    `import { usePublishStore } from "@/store/publishStore";`
  - `src/hooks/useAppBoot.ts`
  - `src/hooks/__tests__/usePublishRunner.test.ts`
- `src/stores/` — slice 体系：`appStore.ts`（组合根）、`appStoreHelpers.ts`、
  `appStoreMutations.ts`、`favoriteConfigs.ts`、`favoritesSlice.ts`、
  `preferenceSlice.ts`、`publishStateSlice.ts`、`repositorySlice.ts`、
  `uiStateSlice.ts`、`__tests__/`。**不要动这些文件的内容。**
- 路径别名：`@/` 指向 `src/`（见 `tsconfig.json` / `vite.config.ts`）。

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck | `pnpm typecheck` | exit 0 |
| 单测 | `pnpm test` | all pass |
| 残留检查 | `grep -rn "store/publishStore" src` | 无输出 |
| 目录已删 | `test -d src/store; echo $?` | 1 |

## Scope

**In scope**:
- `src/store/publishStore.ts` → 移动为 `src/stores/publishStore.ts`（`git mv`）
- 三个引用文件的 import 路径更新：
  `src/features/publish/usePublishExecute.ts`、`src/hooks/useAppBoot.ts`、
  `src/hooks/__tests__/usePublishRunner.test.ts`
- 删除空目录 `src/store/`

**Out of scope** (do NOT touch):
- `src/stores/` 现有 9 个文件的**内容**——尤其不要尝试把 `publishStore` 并入
  `appStore`/`publishStateSlice`（见 Why：功能不重叠，合并是错误方向）。
- `publishStore.ts` 自身的逻辑——纯搬移，不改一行实现。
- `src/lib/store/`（如存在）——那是后端 store API 封装层，与本计划无关。

## Git workflow

- Branch: `advisor/011-merge-store-dirs`
- Commit 建议：`refactor(stores): 将 publishStore 迁入 stores 目录，消除双目录`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: 移动文件

`git mv src/store/publishStore.ts src/stores/publishStore.ts`
（git mv 后 `src/store/` 目录自动消失；若残留空目录则 `rmdir src/store`。）

**Verify**: `test -d src/store; echo $?` → 1；
`test -f src/stores/publishStore.ts; echo $?` → 0。

### Step 2: 更新三个引用

把三个文件中的 `"@/store/publishStore"` 全部改为 `"@/stores/publishStore"`：

```
src/features/publish/usePublishExecute.ts:8
src/hooks/useAppBoot.ts
src/hooks/__tests__/usePublishRunner.test.ts
```

**Verify**: `grep -rn "store/publishStore" src | grep -v "stores/publishStore"`
→ 无输出。

### Step 3: 回归

**Verify**: `pnpm typecheck` → exit 0；`pnpm test` → all pass。

## Test plan

不新增测试——`src/hooks/__tests__/usePublishRunner.test.ts` 本身就是引用方，
它通过即证明搬移无损。回归命令见 Step 3。

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `src/store/` 目录不存在
- [ ] `src/stores/publishStore.ts` 存在且内容与原文件一致（仅路径变化）
- [ ] `grep -rn "@/store/publishStore" src` 无输出
- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` all pass
- [ ] `git status` 改动仅限 In scope 文件（及 plans/README.md 状态行）
- [ ] `plans/README.md` 状态行已更新

## STOP conditions

Stop and report back (do not improvise) if:

- `grep -rln "store/publishStore" src` 找到的引用方不止上述 3 个文件
  （代码已漂移，需重新枚举后再动）。
- `src/store/` 下出现了 `publishStore.ts` 以外的文件。
- typecheck 失败且错误不在这 4 个被改文件里——说明有隐藏耦合，报告而非扩大改动面。

## Maintenance notes

- 迁移后 `src/stores/` 同时含"独立 store"（publishStore）与"appStore slices"。
  若未来第二个独立 store 出现，可考虑在 `src/stores/README.md` 写一行约定
  区分两种模式——当前一个文件不值得。
- Reviewer 只需确认：git 显示为 rename（相似度 100%）而非 delete+add 带改动。
