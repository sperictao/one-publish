# Plan 001: 建立 Geist 微原语（SectionLabel / CodeWell / IconChip）并为 Input、Select 增加尺寸变体

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 4603006..HEAD -- src/components/ui/ src/i18n/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `4603006`, 2026-07-12

## Why this matters

代码库刚完成一轮"全页面 Geist token 对齐"（commit 4603006），但三类视觉模式仍在 20+ 个调用点手写重复：大写小节标签（19 处）、mono 代码井（11 处）、蓝色图标 chip（13 处），以及 11 处对 Input/SelectTrigger 手写 `h-8` 覆盖。每一处手写都是未来漂移的入口。本计划把这四类模式收敛为共享原语，后续 Plan 002/003 将把现有调用点迁移过来。

## Current state

- `src/components/ui/` 是本仓库的 shadcn 风格原语目录。已有原语可作为结构范本：
  - `src/components/ui/app-dialog-badge.tsx` — 无状态展示原语的标准写法（variant 映射表 + `cn()` 合并 className），**新原语照抄这个文件的结构**。
  - `src/components/ui/help-tip.tsx` — 带交互的小原语范本。
- `cn()` 工具从 `@/lib/utils` 导入；所有 className 合并必须经过它。
- 手写模式现状（迁移目标，本计划只建原语、不迁移调用点）：
  - 大写小节标签（例，`src/components/environment/EnvironmentCheckDialog.tsx:305`）：
    ```tsx
    <div className="text-label-12 font-semibold text-muted-foreground uppercase px-1">
    ```
  - mono 代码井（例，`src/components/release/ReleaseChecklistDialog.tsx:532`）：
    ```tsx
    <div className="rounded-sm border border-border bg-muted p-3 text-label-12-mono font-mono whitespace-pre-wrap break-all">
    ```
  - 图标 chip（例，`src/components/ui/section-shell.tsx:33`）：
    ```tsx
    <span className="flex size-8 flex-shrink-0 items-center justify-center rounded-sm bg-interactive/10 text-interactive">
    ```
- `src/components/ui/input.tsx` 当前无尺寸概念，固定 `h-10`；`bare` 布尔 prop 已存在（保留）。
- `src/components/ui/select.tsx` 的 `SelectTrigger` 固定 `h-10`。
- DESIGN.md 尺寸 token：input 40px（默认）、input-small 32px、input-large 48px。仓库现网只用到 40 和 32 两档，**只实现 `default` 和 `sm` 两档**（YAGNI）。
- Tailwind 已配置的相关 token：`text-label-12`、`text-label-12-mono`、`text-label-13-mono`、`rounded-sm`(6px)、`ease-geist`。字体族用 `font-mono` 类。

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Typecheck | `pnpm typecheck`         | exit 0              |
| Tests     | `pnpm test`              | 全部通过（基线 260 条） |
| 单测（快） | `./node_modules/.bin/vitest run src/components/ui/__tests__` | 全部通过 |

## Scope

**In scope**（只允许改/建这些文件）:
- `src/components/ui/section-label.tsx`（新建）
- `src/components/ui/code-well.tsx`（新建）
- `src/components/ui/icon-chip.tsx`（新建）
- `src/components/ui/input.tsx`（加尺寸变体）
- `src/components/ui/select.tsx`（SelectTrigger 加尺寸变体）
- `src/components/ui/__tests__/`（可选：新增冒烟测试）

**Out of scope**（不要动）:
- 一切调用点迁移（Plan 002/003 负责）。
- `src/components/ui/button.tsx`、`dialog.tsx` 等其余原语。
- `src/index.css`、`tailwind.config.cjs` — token 层已完备，不需要新 token。

## Git workflow

- Branch: `advisor/001-geist-micro-primitives`（从 `main` 切出）
- Commit 风格：conventional + 中文描述，例：`feat(ui): 新增 SectionLabel/CodeWell/IconChip 微原语`
- 不要 push、不要开 PR，除非操作者明确指示。

## Steps

### Step 1: 新建 `src/components/ui/section-label.tsx`

照 `app-dialog-badge.tsx` 的结构写一个无状态组件：

```tsx
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SectionLabelProps {
  children: ReactNode;
  className?: string;
  as?: "div" | "span" | "p";
}

/** Geist 小节标签：大写、label-12、次级色。全库统一样式，禁止手写 tracking。 */
export function SectionLabel({ children, className, as: Component = "div" }: SectionLabelProps): ReactNode {
  return (
    <Component className={cn("text-label-12 font-semibold uppercase text-muted-foreground", className)}>
      {children}
    </Component>
  );
}
```

注意：**不含** `tracking-*`（DESIGN.md 禁手写字距，heading token 自带的除外）。

**Verify**: `pnpm typecheck` → exit 0

### Step 2: 新建 `src/components/ui/code-well.tsx`

```tsx
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface CodeWellProps {
  children: ReactNode;
  className?: string;
  /** pre 保留换行（命令/日志）；div 用于单行路径等 */
  as?: "pre" | "div";
}

/** Geist mono 代码井：muted 底、border、6px 圆角、mono 排版 token。 */
export function CodeWell({ children, className, as: Component = "pre" }: CodeWellProps): ReactNode {
  return (
    <Component
      className={cn(
        "rounded-sm border border-border bg-muted p-3 font-mono text-label-12-mono text-foreground whitespace-pre-wrap break-all",
        className
      )}
    >
      {children}
    </Component>
  );
}
```

**Verify**: `pnpm typecheck` → exit 0

### Step 3: 新建 `src/components/ui/icon-chip.tsx`

```tsx
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type IconChipSize = "sm" | "md" | "lg";

const sizeClassName: Record<IconChipSize, string> = {
  sm: "size-7",
  md: "size-8",
  lg: "size-10",
};

interface IconChipProps {
  children: ReactNode;
  className?: string;
  size?: IconChipSize;
}

/** Geist 图标 chip：interactive/10 底 + interactive 前景，6px 圆角。 */
export function IconChip({ children, className, size = "md" }: IconChipProps): ReactNode {
  return (
    <span
      className={cn(
        "flex flex-shrink-0 items-center justify-center rounded-sm bg-interactive/10 text-interactive",
        sizeClassName[size],
        className
      )}
    >
      {children}
    </span>
  );
}
```

**Verify**: `pnpm typecheck` → exit 0

### Step 4: Input 加 `inputSize` 变体

修改 `src/components/ui/input.tsx`：新增 prop `inputSize?: "default" | "sm"`（避免与原生 `size` 属性冲突，务必用这个名字）。`default` 保持现状 `h-10`；`sm` 输出 `h-8`。实现方式：把现有两条 className 字符串里的 `h-10` 抽出，按 `inputSize` 选择 `h-10`/`h-8`，其余不变。`bare` 与 `inputSize` 正交。

**Verify**: `pnpm typecheck` → exit 0；`./node_modules/.bin/vitest run src/components/ui/__tests__` → 通过

### Step 5: SelectTrigger 加 `size` 变体

修改 `src/components/ui/select.tsx` 的 `SelectTrigger`：新增 prop `size?: "default" | "sm"`（Radix Trigger 无原生 size 冲突）。`sm` → `h-8`，默认 `h-10`。同样只替换高度类。

**Verify**: `pnpm typecheck` → exit 0

### Step 6: 冒烟测试（可选但推荐）

在 `src/components/ui/__tests__/` 新增 `micro-primitives.test.tsx`，模式照抄 `src/components/ui/__tests__/button.test.tsx`：render 每个新原语，断言关键 class（如 `SectionLabel` 渲染结果 `classList` 含 `uppercase`；`Input inputSize="sm"` 含 `h-8`）。

**Verify**: `pnpm test` → 全部通过，新增用例通过

## Test plan

- 新测试文件 `src/components/ui/__tests__/micro-primitives.test.tsx`：SectionLabel/CodeWell/IconChip 各 1 条渲染断言 + Input/SelectTrigger 尺寸各 1 条。
- 结构范本：`src/components/ui/__tests__/button.test.tsx`。
- 验证：`pnpm test` 全绿。

## Done criteria

- [ ] `pnpm typecheck` exit 0
- [ ] `pnpm test` exit 0（含新增用例）
- [ ] 三个新原语文件存在且不含 `tracking-`、`rounded-md`、裸 hex
- [ ] `git status` 无 in-scope 之外的改动
- [ ] `plans/README.md` 状态行已更新

## STOP conditions

- `input.tsx` / `select.tsx` 现状与"Current state"描述不符（如已有尺寸 prop）。
- 新增 prop 引发既有测试失败且原因不是断言过时。
- 发现同名原语已存在。

## Maintenance notes

- Plan 002/003 会把 40+ 调用点迁到这些原语上；review 时盯住"原语 API 是否被调用点倒逼加洞"（例如有人想传 `tracking` 进来——拒绝）。
- 未来若需要 48px 输入框，加 `lg` 档即可，token 已在 DESIGN.md。
