# Plan 003: 收敛弹窗内的自造样式配方到共享原语（SettingsDialog / EnvironmentCheckDialog）

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 4603006..HEAD -- src/components/layout/SettingsDialog.tsx src/components/environment/EnvironmentCheckDialog.tsx`
> 若上述文件已变动，先比对"Current state"摘录与现场代码；不一致即 STOP。

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED（SettingsDialog 体量大）
- **Depends on**: plans/001-geist-micro-primitives.md
- **Category**: tech-debt
- **Planned at**: commit `4603006`, 2026-07-12

## Why this matters

两个最大的弹窗各自维护一套模块级样式常量：`SettingsDialog.tsx` 顶部 7 个 `GEIST_*` 常量 + 1 个 `actionButtonBase`，`EnvironmentCheckDialog.tsx` 内部 `sectionTile`/`outlineButtonBase`。它们复述的正是 `Card` 原语、`Button` 变体和 index.css surface 类已经提供的东西——每份副本都是一个独立漂移点（本轮审计中它们确实各漂移出了不同的值才被逐个修正）。收敛后，"卡片长什么样"只有一个定义处。

## Current state

- token/原语现状（收敛目标，全部已存在）：
  - `Card`（`src/components/ui/card.tsx`）= `surface-raised rounded-sm text-card-foreground`，`surface-raised` = 卡片底+border+raised 阴影（`src/index.css`）。
  - `Button` 变体（`src/components/ui/button.tsx`，commit 4603006 后已严格对表）：`outline` = 透明底+border+悬停描边阶梯；`ghost` = gray-alpha 悬停；`size="sm"` = h-8。
  - `AppDialogBadge`（`src/components/ui/app-dialog-badge.tsx`）：success/warning/danger/info/neutral 状态胶囊。
  - Plan 001 产出：`SectionLabel`、`CodeWell`、`IconChip`。
- `src/components/layout/SettingsDialog.tsx:86-100` 现状：
  ```ts
  const GEIST_CARD =
    "rounded-sm border border-border bg-card shadow-raised overflow-hidden";
  const GEIST_CARD_PAD = "rounded-sm border border-border bg-card shadow-raised";
  const GEIST_ROW_HOVER =
    "hover:bg-gray-alpha-100 transition-colors duration-150 ease-geist";
  const GEIST_DIVIDER = "h-px bg-border";
  const GEIST_INPUT =
    "surface-input";
  const GEIST_KBD =
    "rounded-sm border border-border bg-muted";
  const GEIST_CODE_BG =
    "bg-muted border border-border";
  ```
  以及 `SettingsDialog.tsx:885` 附近：
  ```ts
  const actionButtonBase =
    "h-8 px-3 text-button-12 font-normal text-foreground transition-colors duration-150 ease-geist shrink-0 flex items-center gap-1.5";
  ```
  另有两处内联主按钮配方（约 992、1020 行）：`"h-8 px-3 bg-primary text-primary-foreground hover:bg-gray-900 ... text-button-12 font-semibold ..."`。
- `src/components/environment/EnvironmentCheckDialog.tsx:283-286` 现状：
  ```ts
  const sectionTile = "rounded-sm border border-border bg-card";
  const outlineButtonBase =
    "rounded-sm border border-border bg-transparent text-foreground hover:bg-gray-alpha-100 transition-colors duration-150 ease-geist";
  ```
  其 hero 状态胶囊（约 311-323 行）手写三色分支：
  ```tsx
  <span className={cn(
    "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-label-12 font-semibold border shadow-none",
    grouped.critical.length > 0
      ? "bg-destructive/10 text-destructive border-destructive/20"
      : grouped.warning.length > 0
        ? "bg-warning/10 text-warning border-warning/20"
        : "bg-success/10 text-success border-success/20"
  )}>
  ```
  这与 `AppDialogBadge` 的 danger/warning/success 变体（status-* 类）完全同义。
- 仓库测试对这两个文件无 className 查询耦合（测试目录里无 SettingsDialog/EnvironmentCheck 专属测试；以 `pnpm test` 全量回归兜底）。

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Typecheck | `pnpm typecheck`         | exit 0              |
| 全量测试  | `pnpm test`              | 全部通过            |
| 渲染冒烟  | `pnpm dev:renderer` 起本地页后人工打开设置弹窗与环境检查弹窗 | 无空白/布局破碎 |

## Scope

**In scope**:
- `src/components/layout/SettingsDialog.tsx`
- `src/components/environment/EnvironmentCheckDialog.tsx`

**Out of scope**:
- `src/components/ui/**`（原语 API 不为这两个文件开洞；缺能力就 STOP 上报）。
- 弹窗的信息架构、逻辑、i18n key。
- 其他弹窗文件。

## Git workflow

- Branch: `advisor/003-dialog-recipe-consolidation`
- Commit 例：`refactor(ui): 设置与环境检查弹窗收敛到共享 Geist 原语`
- 不 push、不开 PR，除非操作者指示。

## Steps

### Step 1: SettingsDialog — 卡片壳收敛
- `GEIST_CARD` / `GEIST_CARD_PAD` 的使用点（`grep -n "GEIST_CARD" src/components/layout/SettingsDialog.tsx`）改用 `<Card>`：`GEIST_CARD` → `<Card className="overflow-hidden">`，`GEIST_CARD_PAD` → `<Card>`。删除这两个常量。
- 注意 `Card` 需要从 `@/components/ui/card` 导入。

**Verify**: `pnpm typecheck` → exit 0；`grep -c "GEIST_CARD" src/components/layout/SettingsDialog.tsx` → 0

### Step 2: SettingsDialog — 输入与杂项常量
- `GEIST_INPUT` 只是 `"surface-input"` 的别名：全部使用点直接写 `surface-input`（或依赖 Input/SelectTrigger 原语自带的 surface-input），删除常量。
- `GEIST_KBD` / `GEIST_CODE_BG` 使用点换 Plan 001 的 `CodeWell`（`as="div"`，快捷键 kbd 处保留 `<kbd>` 外壳时以 `className` 传差异）。若某处语义确实不是"代码井"（如纯 kbd 键帽），保留内联 `rounded-sm border border-border bg-muted` 并加注释说明。
- `GEIST_DIVIDER`、`GEIST_ROW_HOVER` 保留（一个是分隔线、一个是行悬停，无对应原语且只此一份定义——不为收敛而收敛）。

**Verify**: `pnpm typecheck` → exit 0

### Step 3: SettingsDialog — 按钮配方收敛
- `actionButtonBase` 的使用点改为 `<Button variant="outline" size="sm" className="text-button-12 font-normal">`（h-8 与 px 由 size="sm" 提供；`gap-1.5 shrink-0` 保留在 className）。删除常量。
- 约 992/1020 行的两个内联主按钮配方改为 `<Button variant="default" size="sm" className="text-button-12 font-semibold">`——`bg-primary/hover:bg-gray-900` 由 default 变体提供，不要重复写。

**Verify**: `pnpm typecheck` → exit 0；`grep -cn "hover:bg-gray-900" src/components/layout/SettingsDialog.tsx` → 0

### Step 4: EnvironmentCheckDialog — 配方收敛
- `sectionTile` 使用点（约 6 处）→ `<Card>`（其中带 `overflow-hidden` 的传 className）。删除常量。
- `outlineButtonBase` 使用点全部是 `<Button variant="outline">` 调用：删掉 className 里与变体重复的部分，保留纯附加项（`text-button-12`、`gap`、`shrink-0`、尺寸交给 `size` prop 或 `h-10` 类）。删除常量。
- hero 状态胶囊（311-323）换 `AppDialogBadge`：`variant={critical ? "danger" : warning ? "warning" : "success"}`，icon 传现有 `statusBadge?.icon`，文字为 `statusBadge?.text`。
- 大写小节标签（`grep -n "uppercase" src/components/environment/EnvironmentCheckDialog.tsx`，约 6 处）换 `SectionLabel`。

**Verify**: `pnpm typecheck` → exit 0；`grep -cn "sectionTile\|outlineButtonBase" src/components/environment/EnvironmentCheckDialog.tsx` → 0

### Step 5: 回归
**Verify**: `pnpm test` → 全部通过；`pnpm check:i18n` → 100%

### Step 6: 双主题人工冒烟
`pnpm dev:renderer` 打开页面（Tauri 后端不可用时允许 mock/空态渲染），检查设置弹窗五个分区与环境检查弹窗在 light/dark 下：卡片边界、按钮尺寸、状态胶囊无回归。

**Verify**: 无空白、无文字截断、按钮高度统一 32px（浏览器 DevTools 量测）

## Test plan

- 不新增测试文件；`pnpm test` 全量回归。
- 若执行者环境可跑 e2e：`pnpm e2e -- --grep settings`（存在对应 spec 时）作为加强验证，失败时按 STOP 处理而非改 e2e。

## Done criteria

- [ ] `grep -rn "GEIST_CARD\|GEIST_INPUT\|GEIST_KBD\|GEIST_CODE_BG\|actionButtonBase\|sectionTile\|outlineButtonBase" src/components` 仅剩 0 处（GEIST_DIVIDER/GEIST_ROW_HOVER 允许保留）
- [ ] `pnpm typecheck`、`pnpm test`、`pnpm check:i18n` 全 exit 0
- [ ] 两文件外无改动（`git status`）
- [ ] `plans/README.md` 状态行已更新

## STOP conditions

- Plan 001 的原语尚未合入（找不到 `SectionLabel` 等导入）。
- 收敛需要给 `ui/**` 原语加新 prop 才能表达现状视觉。
- 替换 `AppDialogBadge` 后 hero 胶囊丢失图标或文字（说明 statusBadge 结构与预期不符）。
- 现场代码与摘录不一致。

## Maintenance notes

- 此后新增设置分区时应直接用 `Card`/`SectionLabel`/`CodeWell`，review 中出现新的模块级样式常量即打回。
- Plan 004 的检查脚本会封禁 `hover:bg-accent` 等模式，但不封"新建样式常量"——那只能靠 review 约定；本计划的 commit message 里写明这条约定。
