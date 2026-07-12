# Plan 006: 增补——清理 002 扫描发现的 4 个漏网行组件（RepositoryRow / RowActionsMenu / RepositoryRowActionsMenu / ResizeHandle）

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on.
> Touch only the files listed as in scope. If any STOP condition occurs,
> stop immediately and report. SKIP updating `plans/README.md` — the
> reviewer maintains it.
>
> **Drift check (run first)**: 在工作树内 `git diff --stat 4603006..HEAD -- src/components/layout/RepositoryRow.tsx src/components/layout/RowActionsMenu.tsx src/components/layout/RepositoryRowActionsMenu.tsx src/components/layout/ResizeHandle.tsx`
> 预期：**空输出**（002 执行时已核实这 4 个文件与基线逐字节一致）。非空即 STOP。

## Status

- **Priority**: P1（Plan 004 门禁的前置）
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/002-workbench-panels-geist-cleanup.md（DONE）
- **Category**: tech-debt
- **Planned at**: commit `4603006`（工作分支 `advisor/geist-refactor-001-005`，基于 d917cfd），2026-07-12

## Why this matters

Plan 002 的残留扫描覆盖整个 layout/publish 目录，但其文件清单漏掉了 RepositoryList 的 4 个子组件。它们携带与已修复主文件完全同类的偏差（不透明悬停、自造焦点环、`rounded-md` 控件、`/70` 降调）。不清理则 Plan 004 的 `check:design` 门禁上线即红。

## Current state（摘录来自 reviewer 亲读，基于 d917cfd 工作树）

`src/components/layout/RepositoryRow.tsx:109`（行按钮，PublishConfigPanel `configRowClass` 的孪生件）：
```tsx
"flex w-full items-start gap-2.5 rounded-md border border-transparent bg-transparent py-2 pr-11 text-left shadow-none outline-none transition-colors duration-150 ease-geist hover:bg-accent focus-visible:ring-2 focus-visible:ring-interactive/30 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
isSelected && "bg-accent",
```

`src/components/layout/RowActionsMenu.tsx:52`（行内"更多操作"按钮）：
```tsx
className="size-6 rounded-md transition-opacity duration-150 ease-geist opacity-0 group-hover:opacity-75 group-focus-within:opacity-75 data-[state=open]:bg-accent/80 data-[state=open]:opacity-100"
```

`src/components/layout/RepositoryRowActionsMenu.tsx:36、42`（菜单项图标 ×2）：
```tsx
icon: <FolderOpen className="size-3.5 text-muted-foreground/70" />,
icon: <Pencil className="size-3.5 text-muted-foreground/70" />,
```

`src/components/layout/ResizeHandle.tsx:92-94`（分栏拖拽手柄）：
```tsx
? "w-1 cursor-col-resize hover:bg-accent"
: "h-1 cursor-row-resize hover:bg-accent",
isDragging && "bg-accent",
```

## 修正映射（不留判断空间）

| 文件:行 | 现状 | 改为 | 依据 |
|---|---|---|---|
| RepositoryRow.tsx:109 | `rounded-md` | `rounded-sm` | 控件 6px 家族 |
| RepositoryRow.tsx:109 | `hover:bg-accent` | `hover:bg-gray-alpha-100` | 悬停 alpha 阶梯 |
| RepositoryRow.tsx:109 | `focus-visible:ring-2 focus-visible:ring-interactive/30 focus-visible:ring-offset-1 focus-visible:ring-offset-background` | `focus-ring` | 双层焦点环统一类 |
| RepositoryRow.tsx:110 | `isSelected && "bg-accent"` | **保留**（选中态既定约定） | — |
| RowActionsMenu.tsx:52 | `size-6` | `size-7`（与 listActionButtonClass 的行内操作钮家族一致） | 28px 行内小操作钮家族 |
| RowActionsMenu.tsx:52 | `rounded-md` | `rounded-sm` | 控件 6px |
| RowActionsMenu.tsx:52 | `data-[state=open]:bg-accent/80` | `data-[state=open]:bg-gray-alpha-200` | 开启态用 alpha 层 |
| RowActionsMenu.tsx:52 | `opacity-0 group-hover:opacity-75 ...` 显隐节奏 | **保留**（悬停显现模式，不是色彩降调） | — |
| RepositoryRowActionsMenu.tsx:36、42 | `text-muted-foreground/70` | `text-muted-foreground` | 禁 alpha 降调文字 |
| ResizeHandle.tsx:92、93 | `hover:bg-accent` | `hover:bg-gray-alpha-200`（1px 手柄需要比 100 更可见的一档） | 悬停 alpha 阶梯 |
| ResizeHandle.tsx:94 | `isDragging && "bg-accent"` | `isDragging && "bg-gray-alpha-300"`（拖拽=active，取 300 档） | 100/200/300 阶梯 |

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Typecheck | `./node_modules/.bin/tsc --noEmit` | exit 0 |
| 相关单测  | `./node_modules/.bin/vitest run src/components/layout/__tests__` | 全部通过 |
| 全量测试  | `./node_modules/.bin/vitest run` | 266 通过（含 002 后基线） |

## Scope

**In scope**: 上表 4 个文件；及其 `__tests__` 中因断言旧类名需同步的测试。
**Out of scope**: 其他一切文件；`isSelected`/`data-list-*`/aria/handler 逻辑。

## Git workflow

- 在分支 `advisor/geist-refactor-001-005` 直接提交（不新建分支、不 push）。
- Commit 例：`style(ui): 行组件与分栏手柄补齐 Geist 悬停/焦点环约定`

## Steps

### Step 1: 按映射表修改 4 个文件
**Verify**: `./node_modules/.bin/tsc --noEmit` → exit 0

### Step 2: 残留复扫（与 002 同款命令）
```
grep -rnE 'tracking-\[|hover:bg-accent|ring-interactive/30|ring-ring/25|!h-|!w-|/70\b|/80\b|/90\b' src/components/layout src/components/publish --include="*.tsx" --include="*.ts" | grep -v __tests__ | grep -v prototype
```
**Verify**: 输出仅剩 1 行 `PublishRunCard` 的 `bg-background/80`（合规保留项）

### Step 3: 回归 + 提交
**Verify**: `./node_modules/.bin/vitest run` → 266 通过；提交并报告 hash

## Done criteria

- [ ] Step 2 扫描仅剩 `bg-background/80` 一行
- [ ] `tsc --noEmit`、全量 vitest exit 0
- [ ] `git status` 无 in-scope 外改动
- [ ] 已提交

## STOP conditions

- Drift check 非空。
- 任何测试失败且原因不是"断言旧类名"。

## Maintenance notes

- 本计划落地后 Plan 004 门禁可零白名单起跑（004 的 offscale 正则已由 reviewer 修订为 `(h|size)-(9|11)`，28px 行内操作钮家族与 IconChip sm 合法）。
