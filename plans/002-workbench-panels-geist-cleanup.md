# Plan 002: 清理工作台三栏面板与右栏卡片的前期 Geist 偏差

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 4603006..HEAD -- src/components/layout/ src/components/publish/PublishRunCard.tsx src/components/publish/ExecutionHistoryCard.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED（触面广、有 className 耦合的测试）
- **Depends on**: plans/001-geist-micro-primitives.md
- **Category**: tech-debt
- **Planned at**: commit `4603006`, 2026-07-12

## Why this matters

弹窗层已在 commit 4603006 完成严格对齐，但工作台三栏面板与右栏卡片是更早轮次改造的，仍残留约 50 处对齐前写法：不透明 `hover:bg-accent` 悬停（规范要求 `gray-alpha` 阶梯）、手写 `tracking-[0.15em]`、控件用 `rounded-md/lg`、alpha 降调文字（`/70` `/80` `/90`）、自造焦点环（`ring-interactive/30 ring-offset-1`，规范是双层环 `.focus-ring`）、`!important` 尺寸。这是同一应用里并存的两套细节语言；本计划把主界面拉到与弹窗一致。

## Current state

修正约定（全部已存在于代码库，无需新建 token）：

- 悬停阶梯：透明底悬停 `hover:bg-gray-alpha-100`、按压 `active:bg-gray-alpha-200`（见 `src/components/ui/button.tsx` ghost 变体，照抄）。
- 焦点环：统一类 `.focus-ring`（定义在 `src/index.css` @layer components，双层环）。
- 选中态填充 `bg-accent` 是既定约定（SettingsDialog 导航同款），**保留**，只改悬停。
- 大写小节标签 → Plan 001 的 `SectionLabel`；图标 chip → `IconChip`。
- 面板外壳 `SidebarPanelShell`/`MainContentShell` 的 `rounded-md` 是既定决策（commit 65a2db8"统一三列布局圆角"），**不改**。

各文件现状摘录与**逐行修正映射**（执行时以此为准，不留判断空间）：

### `src/components/layout/topbarButtonStyles.ts`（整文件重写）

现状（2 行常量）：
```ts
export const topbarIconButtonClass =
  "inline-flex !h-7 !w-9 items-center justify-center rounded-full border border-transparent bg-transparent p-0 text-muted-foreground shadow-none transition-colors duration-150 ease-geist hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:ring-offset-1 focus-visible:ring-offset-background [&_svg]:stroke-[1.5]";
export const topbarViewButtonActiveClass = "!bg-accent !text-foreground";
```
修正：
- `!h-7 !w-9` → `h-8 w-8`（32px 刻度；`!important` 全部移除。若调用点因 Button 默认尺寸盖不过去，在调用点传 `size="sm"` 而不是恢复 `!`）。
- `hover:bg-accent` → `hover:bg-gray-alpha-100`。
- `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:ring-offset-1 focus-visible:ring-offset-background` → `focus-ring`。
- `topbarViewButtonActiveClass` → `"bg-gray-alpha-200 text-foreground"`（去 `!`；若样式被变体覆盖，调整调用点 variant 为 `ghost`）。
- `[&_svg]:stroke-[1.5]` 保留（图标笔画宽度不属于色彩/排版 token 体系）。

### `src/components/layout/RepositoryList.tsx`

| 行 | 现状 | 改为 |
|---|---|---|
| 201 | `listActionButtonClass = "...rounded-full border border-border bg-background ... hover:bg-accent"` | `hover:bg-accent` → `hover:bg-gray-alpha-100`；行尾追加 ` focus-ring`（这些是 icon button，rounded-full 为圆形控件豁免，保留） |
| 341 | `surface-raised flex size-16 ... rounded-lg` | `rounded-lg` → `rounded-sm`（与 EditRepositoryDialog 空态 chip 同款） |
| 428 | `text-label-12 font-semibold uppercase tracking-[0.15em] text-muted-foreground`（品牌字） | 整段换 `<SectionLabel as="span">One Publish</SectionLabel>` |
| 455 | 过滤 pill `...hover:bg-accent` | → `hover:bg-gray-alpha-100`，并追加 `focus-ring` |
| 458 | `text-foreground/80` | → `text-foreground` |
| 456 | `h-[18px] min-w-[18px] ... rounded-full bg-interactive/10 px-1` 计数徽章 | `h-[18px] min-w-[18px]` → `h-4 min-w-4`（16px 刻度） |
| 510 | `search-input-shell surface-input relative rounded-md` | `rounded-md` → `rounded-sm`（输入类控件 6px） |
| 511 | `text-muted-foreground/50` 搜索图标 | → `text-gray-600`（禁 alpha 降调；gray-600 是明确的 token 步） |
| 342 | `text-muted-foreground/30` 空态图标 | → `text-gray-500` |

### `src/components/layout/BranchPanel.tsx`

| 行 | 现状 | 改为 |
|---|---|---|
| 115、209 | `search-input-shell surface-input relative rounded-md` | `rounded-md` → `rounded-sm`（两处） |
| 229 | 行 `...hover:bg-accent cursor-pointer` | → `hover:bg-gray-alpha-100` |
| 230 | `branch.isCurrent && "rounded-lg mx-1 border-0 bg-accent"` | `rounded-lg` → `rounded-sm`（选中填充 `bg-accent` 保留） |

### `src/components/layout/PublishConfigPanel.tsx`

| 行 | 现状 | 改为 |
|---|---|---|
| 411、1026、1186 | 三份**完全相同**的行配方 `"flex w-full items-center gap-2.5 rounded-md border border-transparent ... hover:bg-accent focus-visible:ring-2 focus-visible:ring-interactive/30 focus-visible:ring-offset-1 focus-visible:ring-offset-background"` | 先抽为模块级常量 `const configRowClass = ...`（一处定义三处引用），内容修正：`rounded-md`→`rounded-sm`；`hover:bg-accent`→`hover:bg-gray-alpha-100`；四段 focus-visible → `focus-ring` |
| 419、1040、1199 | 行内图标 chip `size-8 ... rounded-md` | `rounded-md` → `rounded-sm`（`bg-interactive/10` 选中逻辑保留；不强行换 IconChip——此处有选中态分支逻辑） |
| 218、960 | `text-label-12 font-semibold uppercase tracking-[0.15em] text-muted-foreground`（218 还有 hover 变色） | 换 `SectionLabel`；218 处 hover 变色留在外层 button 上（`hover:text-foreground` 移到 SectionLabel 的 `className`） |
| 228、1121 | `animate-spin text-interactive/80` | → `text-interactive`（spinner 保留） |
| 356、1240、1246 | 菜单图标 `text-muted-foreground/70` | → `text-muted-foreground` |
| 537 | 同 RepositoryList:201 的 `listActionButtonClass` 副本 | 同款修正（hover→gray-alpha-100，追加 focus-ring） |

### `src/components/layout/CollapsiblePanel.tsx`

| 行 | 现状 | 改为 |
|---|---|---|
| 74 | `flex h-7 w-7 ... rounded hover:bg-accent transition-colors` | `h-7 w-7`→`size-8`；裸 `rounded`(4px)→`rounded-sm`；`hover:bg-accent`→`hover:bg-gray-alpha-100`；追加 `focus-ring`。**若展开轨道宽度容不下 32px（视觉挤压/溢出），STOP 上报** |

### `src/components/publish/PublishRunCard.tsx`

| 行 | 现状 | 改为 |
|---|---|---|
| 349 | 状态卡 `rounded-lg border p-4` | → `rounded-sm` |
| 356 | 状态图标位 `size-10 ... rounded-md` | → `rounded-sm` |
| 395 | 输出目录行 `rounded-md ... hover:bg-accent focus-visible:ring-2 focus-visible:ring-interactive/30 focus-visible:ring-offset-2 ... disabled:cursor-not-allowed disabled:opacity-70` | `rounded-md`→`rounded-sm`；`hover:bg-accent`→`hover:bg-gray-alpha-100`；focus 段→`focus-ring`；`disabled:opacity-70`→`disabled:text-gray-700`（透明底行，不加灰底） |
| 409、422 | `uppercase tracking-[0.15em]`（409 muted、422 destructive 色） | 换 `SectionLabel`；422 用 `<SectionLabel className="text-destructive">`（SectionLabel 的 muted 色被 className 覆盖，`cn` 后者优先） |
| 421 | 错误井 `rounded-lg` | → `rounded-sm` |
| 431 | 警告井 `rounded-lg` | → `rounded-sm` |
| 444、450 | `text-warning/70`、`border-warning/15`、`text-warning/90` | `/70`与`/90`→`text-warning`；`border-warning/15`→`border-warning/20`（全库警告井统一 /20 配比，见 EnvironmentCheckDialog:299） |
| 472 | 折叠按钮 `hover:bg-accent` + 四段 focus-visible | → `hover:bg-gray-alpha-100` + `focus-ring` |
| 476 | `text-muted-foreground/70` | → `text-muted-foreground` |
| 489 | 终端 `rounded-lg bg-[hsl(var(--terminal-bg))] ... text-label-12` | `rounded-lg`→`rounded-sm`；`text-label-12`→`text-label-12-mono`（已有 font-mono）。`--terminal-bg/fg` 是登记 token，保留 |
| 502 | 遮罩 `bg-background/80` | 保留（语义 token 半透明遮罩，合规） |

### `src/components/publish/ExecutionHistoryCard.tsx`

| 行 | 现状 | 改为 |
|---|---|---|
| 204 | 空态虚线井 `rounded-md` | → `rounded-sm` |
| 214 | 记录行 `rounded-md` | → `rounded-sm` |
| 219 | 状态徽章 `text-label-12 rounded-md px-1.5 py-0.5` | `rounded-md` → `rounded-full`（状态胶囊与 AppDialogBadge 同族） |
| 239、247 | `rounded-lg` 错误/警告井 | → `rounded-sm` |
| 253、255 | `text-warning/70`、`border-warning/15`、`text-warning/90` | 同 PublishRunCard 映射（`text-warning` / `border-warning/20`） |

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Typecheck | `pnpm typecheck`         | exit 0              |
| 相关单测  | `./node_modules/.bin/vitest run src/components/layout/__tests__ src/components/publish/__tests__` | 全部通过 |
| 全量测试  | `pnpm test`              | 全部通过 |
| i18n 校验 | `pnpm check:i18n`        | `i18n coverage: 100%` |

## Suggested executor toolkit

- 先读 `DESIGN.md` 的 Colors / Shapes / Components 三节（仓库根目录），理解 6px 控件 / 12px 模态圆角家族与 gray-alpha 悬停约定。

## Scope

**In scope**:
- `src/components/layout/topbarButtonStyles.ts`
- `src/components/layout/RepositoryList.tsx`
- `src/components/layout/BranchPanel.tsx`
- `src/components/layout/PublishConfigPanel.tsx`
- `src/components/layout/CollapsiblePanel.tsx`
- `src/components/publish/PublishRunCard.tsx`
- `src/components/publish/ExecutionHistoryCard.tsx`
- 上述文件对应 `__tests__` 中因断言 className 需要同步的测试

**Out of scope**:
- `SidebarPanelShell.tsx` / `MainContentShell.tsx` 的外壳 `rounded-md`（既定决策，见上）。
- `src/components/prototype/GeistWorkbenchPrototype.tsx`（dev-only，Plan 005 处理）。
- 所有弹窗文件（已对齐）。
- 任何逻辑、handler、hook、data-testid、`data-list-*`、语义钩子类（`search-input-shell`、`surface-input`、`list-scroll-shell` 类名本身**必须保留**——测试按类名查询）。

## Git workflow

- Branch: `advisor/002-workbench-geist-cleanup`
- Commit 例：`style(ui): 工作台面板与右栏对齐 Geist 悬停/圆角/焦点环约定`
- 不 push、不开 PR，除非操作者指示。

## Steps

### Step 1: topbarButtonStyles.ts 重写
按上表修正两个常量。然后 `grep -rn "topbarIconButtonClass\|topbarViewButton" src --include="*.tsx"` 找全部调用点，确认没有依赖 `!important` 的样式冲突（若按钮尺寸异常，给调用的 `Button` 加 `size="sm"`）。

**Verify**: `pnpm typecheck` → exit 0

### Step 2: RepositoryList.tsx + BranchPanel.tsx
按各自映射表逐行修改。

**Verify**: `./node_modules/.bin/vitest run src/components/layout/__tests__/RepositoryList.test.tsx` → 通过（若测试断言了旧类名，把断言更新为新类名，并在 commit message 里注明）

### Step 3: PublishConfigPanel.tsx
先做三合一常量抽取（行 411/1026/1186），再套映射表其余行。

**Verify**: `./node_modules/.bin/vitest run src/components/layout/__tests__/PublishConfigPanel.test.tsx` → 通过

### Step 4: CollapsiblePanel.tsx + PublishRunCard.tsx + ExecutionHistoryCard.tsx
按映射表修改。

**Verify**: `./node_modules/.bin/vitest run src/components/publish/__tests__` → 通过

### Step 5: 残留扫描
```
grep -rnE 'tracking-\[|hover:bg-accent|ring-interactive/30|ring-ring/25|!h-|!w-|/70\b|/80\b|/90\b' \
  src/components/layout src/components/publish --include="*.tsx" --include="*.ts" | grep -v __tests__ | grep -v prototype
```
预期：0 行（`bg-background/80` 遮罩除外——若出现，确认仅此一处并保留）。

**Verify**: 上述 grep 输出为空或仅含 `bg-background/80`

### Step 6: 全量回归
**Verify**: `pnpm typecheck && pnpm test && pnpm check:i18n` → 全部通过

## Test plan

- 不新增测试；既有 `RepositoryList.test.tsx`、`PublishConfigPanel.test.tsx`、publish 目录测试作为回归网。
- 断言旧类名的测试允许同步更新断言（仅类名字符串，不改测试逻辑）。

## Done criteria

- [ ] Step 5 的残留扫描为空（或仅剩 `bg-background/80`）
- [ ] `pnpm typecheck`、`pnpm test`、`pnpm check:i18n` 全部 exit 0
- [ ] `search-input-shell`、`surface-input`、`list-scroll-shell`、全部 `data-testid`/`data-list-*` 原样存在
- [ ] `git status` 无 in-scope 之外的改动
- [ ] `plans/README.md` 状态行已更新

## STOP conditions

- 现场代码与映射表行号/内容对不上（漂移）。
- CollapsiblePanel 的 32px 按钮导致收起轨道溢出。
- 任何测试失败且原因不是"断言旧类名"。
- 发现必须改动 handler/hook 才能完成样式修正。

## Maintenance notes

- 本计划落地后 Plan 004 的合规检查脚本才能以零白名单起跑。
- review 重点：`!important` 移除后 topbar 按钮在 macOS 拖拽区里的实际渲染尺寸；三栏在 light/dark 双主题下悬停对比度。
- 已刻意保留：选中态 `bg-accent` 填充、圆形图标按钮 `rounded-full`、面板外壳 `rounded-md`。
