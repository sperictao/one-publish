# Plan 007: 门禁预跑发现的 3 处额外漏网偏差（ListReorderControls / RerunChecklistDialog / PublishRunCard 取消钮）

> **Executor instructions**: Follow step by step, run every verification, touch
> only in-scope files, STOP on any STOP condition, commit in the worktree, SKIP
> updating `plans/README.md`. Audit claims against tool results before reporting.
>
> **Drift check (run first)**: 工作树内 `git diff --stat 4603006..HEAD -- src/components/layout/ListReorderControls.tsx src/components/publish/RerunChecklistDialog.tsx` 预期空；`PublishRunCard.tsx` 已被 002 改过（会有 diff，正常）。

## Status

- **Priority**: P1（Plan 004 门禁的前置）
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/002（DONE）
- **Category**: tech-debt
- **Planned at**: commit `4603006`（工作分支 advisor/geist-refactor-001-005 基于 b31e853），2026-07-12

## Why this matters

Plan 004 的合规扫描器在 reviewer 预跑时，除已知的白名单例外外，还打中 3 处 002/003 范围外的真实偏差。不修则 004 门禁无法零白名单起跑。三处都是同类 token 偏差，机械可改。

## Current state（reviewer 亲读，基于 b31e853 工作树）

`src/components/layout/ListReorderControls.tsx:30-34`（拖拽手柄按钮）：
```tsx
"flex size-7 touch-none items-center justify-center rounded-md transition-colors duration-150 ease-geist",
enabled
  ? "cursor-grab text-muted-foreground/35 hover:bg-muted hover:text-foreground/65 active:cursor-grabbing"
  : "cursor-not-allowed text-muted-foreground/20"
```

`src/components/publish/RerunChecklistDialog.tsx:148`（清单项图标位）：
```tsx
<span className="flex size-9 flex-shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
  <Icon className="size-4" />
```

`src/components/publish/PublishRunCard.tsx:320`（取消发布按钮，`variant="outline" size="lg"`）：
```tsx
className="w-full border-destructive/30 bg-destructive/5 text-destructive hover:bg-destructive/10 hover:text-destructive disabled:bg-destructive/5 disabled:text-destructive disabled:opacity-70 sm:w-auto sm:min-w-32"
```

## 修正映射

| 文件:行 | 现状 | 改为 | 依据 |
|---|---|---|---|
| ListReorderControls.tsx:31 | `rounded-md` | `rounded-sm` | 控件 6px |
| ListReorderControls.tsx:33 | `text-muted-foreground/35 hover:bg-muted hover:text-foreground/65` | `text-gray-600 hover:bg-gray-alpha-100 hover:text-foreground` | 禁 alpha 降调 + 悬停用 alpha 阶梯 |
| ListReorderControls.tsx:34 | `text-muted-foreground/20`（禁用态） | `text-gray-500` | 禁 alpha 降调；gray-500 是明确 token 步 |
| RerunChecklistDialog.tsx:148 | `size-9 ... rounded-md bg-muted text-muted-foreground` | `size-8 ... rounded-sm bg-muted text-muted-foreground` | 36px→32px 刻度 + 控件 6px |
| PublishRunCard.tsx:320 | `disabled:opacity-70` | `disabled:text-gray-700`（去掉 opacity；该按钮已有 `disabled:bg-destructive/5 disabled:text-destructive`——**删掉这两个 disabled:destructive 类**，统一为 `disabled:bg-gray-100 disabled:text-gray-700`） | 禁用态标准三件套 |

PublishRunCard.tsx:320 目标 className：
```
w-full border-destructive/30 bg-destructive/5 text-destructive hover:bg-destructive/10 hover:text-destructive disabled:bg-gray-100 disabled:text-gray-700 sm:w-auto sm:min-w-32
```

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `./node_modules/.bin/tsc --noEmit` | exit 0 |
| 全量测试 | `./node_modules/.bin/vitest run` | 266 通过 |

## Scope

**In scope**: 上述 3 文件；其 `__tests__` 需同步的断言。
**Out of scope**: 其他一切；handler/aria/逻辑。**不要**动 `switch.tsx`、`PublishRunCard.tsx:293`、`SettingsDialog.tsx:581`——那三处是 Plan 004 白名单里的合规例外。

## Git workflow

在分支 `advisor/geist-refactor-001-005` 直接提交。Message：`style(ui): 补齐拖拽手柄/重跑清单/取消钮的 Geist token 偏差`

## Steps

### Step 1: 按映射表改 3 文件
**Verify**: `./node_modules/.bin/tsc --noEmit` → exit 0

### Step 2: 复扫这 3 处模式归零
```
grep -rnE 'hover:bg-muted|(h|size)-9\b|disabled:opacity-|/35\b|/65\b|/20\b' src/components/layout/ListReorderControls.tsx src/components/publish/RerunChecklistDialog.tsx src/components/publish/PublishRunCard.tsx
```
**Verify**: 输出为空（PublishRunCard 的 `disabled:opacity-100` 在 293 行是白名单例外，但本 grep 的 `disabled:opacity-` 会打中它——确认仅剩 293 行那一条 `disabled:opacity-100`，其余归零即可）

### Step 3: 回归 + 提交
**Verify**: `./node_modules/.bin/vitest run` → 266 通过；提交报 hash

## Done criteria

- [ ] Step 2 复扫仅剩 PublishRunCard:293 的 `disabled:opacity-100`
- [ ] `tsc --noEmit`、全量 vitest exit 0
- [ ] `git status` 无 in-scope 外改动
- [ ] 已提交

## STOP conditions

- Drift check 中 ListReorderControls/RerunChecklistDialog 非空（漂移）。
- 测试失败且原因非"断言旧类名"。

## Maintenance notes

- 本计划落地后，Plan 004 的白名单只需保留 3 条（switch.tsx / PublishRunCard:293 / SettingsDialog:581），全部为真实合规例外。
