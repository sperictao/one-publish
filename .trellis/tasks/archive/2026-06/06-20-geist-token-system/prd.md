# Geist token 体系重建

## Goal

在 `tailwind.config.cjs` + `src/index.css` + `src/hooks/useTheme.ts` 落地 Geist 完整 token 体系（色阶 / typography / spacing / components），语义层重映射到 Geist step，引入 P3 oklch 宽色域，统一运行时 accent，清理死代码。为后续 UI/业务组件重构提供 token 基座。

## 前置

无。本任务是其余子任务的依赖。

## Requirements

- **R1.1 颜色变量升级**：将 `hsl(var(--*))` 形式升级为 `var(--*)`（变量值携带完整 color 函数），以承载 P3 oklch。
- **R1.2 完整色阶落地**：`src/index.css` `:root`（light）与 `.dark` 定义全部 Geist step 变量——`gray-100~1000`、`gray-alpha-100~1000`、`blue/red/amber/green/teal/purple/pink` 各 100~1000，值取自 design.md / design.dark.md。
- **R1.3 P3 宽色域**：为每个 accent step 在 `@media (color-gamut: p3)` 下提供 oklch 覆盖值（取自 design.md `*-p3`）。灰阶无 P3 变体。
- **R1.4 语义层重映射**：shadcn 语义变量（`--background`/`--foreground`/`--card`/`--primary`/`--secondary`/`--muted`/`--accent`/`--destructive`/`--success`/`--warning`/`--interactive`/`--border`/`--input`/`--ring`）重映射到对应 Geist step（映射表见父 design.md §2.2）。修正 `--secondary` 重载（gray-100 → gray-900）。新增 `--background-200`。
- **R1.5 step token 暴露**：`tailwind.config.cjs` `theme.extend.colors` 暴露 `gray`/`gray-alpha`/`blue`/`red`/`amber`/`green`/`teal`/`purple`/`pink` 各 step，引用 `var(--*)`。
- **R1.6 typography token**：`theme.extend.fontSize` 用对象语法定义 heading(72~14)/button(16/14/12)/label(20~12)/copy(24~13) 命名 token，含 lineHeight + letterSpacing（值取自 design.md typography）。
- **R1.7 components token**：`src/index.css` `@layer components` 定义 `.btn-primary`/`.btn-secondary`/`.btn-tertiary`/`.btn-error`/`.btn-small`/`.btn-large`/`.input-base`/`.input-small`/`.input-large`，对齐 design.md components（height/radius/padding/填色/hover-active step）。
- **R1.8 focus ring 工具**：定义统一的 focus ring 工具（2px surface gap + 2px blue ring），供组件层引用。
- **R1.9 useTheme 统一**：运行时 accent 写入改为写 step 变量（`--blue-700` 等），`--interactive` 作为 `--blue-700` 别名。删除零消费的 `--settings-accent*`/`--settings-sidebar-selected-*`/`--settings-card-selected-border` 及其写入逻辑。
- **R1.10 死代码清理**：删除父 design.md §7 列出的死规则、空类、零消费变量、未用 Tailwind 工具。
- **R1.11 不破坏现有调用**：语义类名（`bg-background` 等）保持可用（底层值变了但类名不变）；测试锚点 CSS 类（`.list-scroll-shell`/`.repo-list-grid`/`.geist-scrollbar`）保留。

## Acceptance Criteria

- [ ] `src/index.css` light/dark 双主题定义全部 Geist step 变量，值与 design.md/design.dark.md 一致。
- [ ] `@media (color-gamut: p3)` 为所有 accent step 提供 oklch 覆盖。
- [ ] `tailwind.config.cjs` 暴露 gray/gray-alpha/各 accent step + typography fontSize token + spacing 别名（如有）。
- [ ] shadcn 语义变量重映射到 Geist step；`--secondary` 修正为 gray-900；`--background-200` 新增。
- [ ] `@layer components` 定义 button/input 组件类，值对齐 design.md components token。
- [ ] `useTheme.ts` accent 写入统一到 step 变量；零消费 settings 变量及写入逻辑删除。
- [ ] 父 design.md §7 死代码清单全部清理。
- [ ] `pnpm typecheck && pnpm test` 全绿（语义类名仍可用，测试锚点未破坏）。
- [ ] grep 校验：`hsl(var(--` 在 tailwind.config.cjs 中已替换为 `var(--`（颜色映射）。

## Notes

- 技术契约见父任务 `design.md` §2-§7。本任务 design.md 聚焦执行细节与 token 命名清单。
- 本任务不改动业务组件 className（除死代码清理涉及的 `scrollbar-fade` 引用删除）；组件层对齐在子任务 2/3。
