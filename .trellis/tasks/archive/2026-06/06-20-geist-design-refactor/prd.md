# 使用 Geist design.md/design.dark.md 重构所有页面与组件

## Goal

将仓库的样式 token 体系与全部组件对齐到 `design.md`（Light）与 `design.dark.md`（Dark）定义的 Vercel Geist 设计系统，消除手写魔数与语义重载，使视觉表达由 token 驱动而非各处自行拼写。

## Background

仓库已完成第一轮 Geist 迁移（移除 Liquid Glass、对齐 radii/shadow/font），但 token 层仍是 shadcn 语义压缩桶，未编码 Geist 完整体系：

- **颜色**：只有 `primary/secondary/muted/accent/destructive/success/warning/interactive/border/input/ring` 等语义桶，无 `gray-100~1000`、`gray-alpha-*`、各 accent 的 10 步 step token，无 `background-200`，无 P3 宽色域。`--secondary` 被重载为 `gray-100`（light）而 DESIGN.md 的 `secondary = gray-900`。
- **Typography**：DESIGN.md 定义 28 个 typography token（heading/button/label/copy，含 mono，各带 fontSize/fontWeight/lineHeight/letterSpacing），仓库零编码，业务组件手写 `text-[14px] font-semibold tracking-[-0.224px]` 等串（仅 SettingsDialog 就复制 13+ 次）。
- **Spacing**：DESIGN.md 定义 4/8/12/16/24/32/40/64/96 的 Geist scale，仓库直接用 Tailwind 默认 spacing（含 `1.5/2.5/3.5` 等 Geist scale 外步长）。
- **Components**：DESIGN.md 定义 button-primary/secondary/tertiary/error/small/large、input/small/large 的成套 token，仓库未暴露。
- **死代码**：`.config-list-row`/`.config-item-selected` CSS 规则、`scrollbar-fade` 类、`--settings-*` 系列别名变量、`--interactive-foreground`/`--settings-sidebar-selected-*` 等零消费变量需清理。

## Scope

涵盖 `src/App.tsx`、`src/components/{ui,layout,publish,environment,release}/**`、`src/index.css`、`tailwind.config.cjs`、`src/hooks/useTheme.ts`（运行时 accent 写入）。不涉及 Rust 后端、ts-rs 契约、业务逻辑（store/hooks/lib）的行为变更，仅触碰它们的视觉表达层。

## Constraints

- **兼容性策略（严格）**：不保留 legacy 语义桶作 fallback。token 直接替换，调用点统一迁移。若决定保留 shadcn 语义类名作为「Geist token 的别名映射」而非独立桶，需在 design.md 中明确这是别名而非兼容层。
- **测试锚点不可破坏**：以下选择器/字面量被单测与 e2e 锚定，重构必须保留：
  - CSS 类：`.list-scroll-shell`、`.repo-list-grid`、`.geist-scrollbar`
  - className 字面量：`[overflow-wrap:anywhere]`、`pl-3`、`pl-10`
  - data 属性：`data-list-item-id`、`data-list-row`、`data-list-visual-target`、`data-list-menu-open`、`data-selected`、`data-testid`（`publish-execute-btn`/`publish-status-panel`/`publish-command-preview`/`pubxml-select-*`/`new-config-btn`/`config-management-btn`/`repo-search-input`）
  - ARIA name 与可见文案（`拖动排序`、`新建配置`、`配置管理`、`历史记录`、`通用/外观/关于`、`将执行的命令` 等）
- **可聚焦元素的 focus ring** 不可移除（DESIGN.md 要求 `:focus-visible` 双层 ring）。
- **不引入新依赖**：在现有 Tailwind v3 + shadcn/ui + Radix 栈内完成。
- **不动业务逻辑**：store/hooks/lib 的行为不变，仅替换视觉 className 与 token 引用。

## Requirements

### R1 — Token 体系重建
- 在 `tailwind.config.cjs` + `src/index.css` 落地 Geist 完整色阶（`gray-*`、`gray-alpha-*`、`blue/red/amber/green/teal/purple/pink` 各 10 步），light/dark 双主题，值取自 design.md/design.dark.md。
- 落地 typography token（heading/button/label/copy + mono），以可消费的 Tailwind 工具或语义 class 形式提供，含 fontSize/fontWeight/lineHeight/letterSpacing。
- 落地 Geist spacing scale（4/8/12/16/24/32/40/64/96），作为 Tailwind spacing 别名。
- 落地 components token（button/input 各 variant 与 size）。
- 清理死规则与零消费变量。
- 保留运行时 accent 写入机制（`useTheme.ts`），但将其统一到新 token 命名。

### R2 — UI 基础组件对齐
- `src/components/ui/**` 16 个组件改用新 token 与 typography，消除手写魔数；对齐 DESIGN.md components token 的 variant/size/height/radius。
- 统一 focus ring 实现（消除全局 outline 与组件 ring 双层叠加的冲突）。

### R3 — 业务组件与页面重构
- `src/components/layout/**`、`src/components/publish/**`、`src/components/environment/**`、`src/components/release/**`、`src/App.tsx` 全部改用新 token/typography，消除手写 `text-[Npx]`/`tracking-[...]`/魔数尺寸。
- 保留所有测试锚点（类名/data/aria/文案）。

### R4 — 验证
- `pnpm typecheck`、`pnpm test`、`pnpm doctor` 全绿。
- `pnpm e2e` 全绿（测试锚点未破坏）。
- 视觉回归：light/dark 两主题下，主窗、设置、各 Dialog 视觉与 design.md 一致（圆角/间距/字号/色阶/阴影）。

## Acceptance Criteria

- [x] `tailwind.config.cjs` 与 `src/index.css` 暴露 Geist 完整色阶、typography、spacing、components token，light/dark 双主题值与 design.md/design.dark.md 一致。
- [x] 死规则（`.config-list-row`/`.config-item-selected`）、`scrollbar-fade` 空类、零消费的 `--settings-*` 别名变量、未用的 `--interactive-foreground` 等已删除。
- [x] `src/components/ui/**` 全部组件无手写 `text-[Npx]`/`tracking-[...]` 魔数，variant/size 对齐 DESIGN.md components token。
- [x] `src/components/{layout,publish,environment,release}/**` 与 `App.tsx` 无手写字号/字距魔数串（grep `text-\[`、`tracking-\[` 无业务魔数残留）。
- [x] focus ring 全局统一，无双层叠加。
- [x] `pnpm typecheck && pnpm test && pnpm doctor && pnpm e2e` 全绿（6 个 e2e 失败经 baseline 复现确认均为 pre-existing，与重构无关）。
- [ ] light/dark 视觉与 design.md/design.dark.md 一致（待人工 `pnpm dev` 核对）。

## Subtask Map

父任务持有需求与跨子任务验收，不直接实施。子任务各自可独立规划/实施/验证/归档：

1. **geist-token-system** — R1：Token 体系重建（tailwind + index.css + useTheme 统一 + 死代码清理）。其余子任务依赖本任务的 token 命名，需在其 prd/implement 中声明前置顺序。
2. **geist-ui-primitives** — R2：`components/ui/**` 16 个基础组件对齐。
3. **geist-business-components** — R3：layout/publish/environment/release + App 业务组件重构。
4. **geist-verify** — R4：全量验证（typecheck/test/doctor/e2e）+ 视觉回归 + 死代码 grep 校验。

## Cross-Subtask Acceptance

- 子任务 2/3 的所有 className 引用的 token 必须在子任务 1 中已定义；不得引用未落地 token。
- 子任务 4 在子任务 1/2/3 全部完成后执行，作为父任务的最终门禁。
- 任一子任务归档前必须保证其涉及的测试锚点未被破坏。

## Notes

- 技术设计见 `design.md`，执行计划见 `implement.md`（复杂任务，二者均需在 `task.py start` 前完成）。
- 子任务的 prd/design/implement 在各自目录下单独维护。
