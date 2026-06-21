# Implement — Geist token 体系重建

有序执行步骤，每步附验证。

## 步骤

1. **备份/确认基线** → `git status` 干净，`pnpm typecheck && pnpm test` 全绿（记录基线）。
2. **改 `tailwind.config.cjs` 颜色映射形式** → `hsl(var(--*))` → `var(--*)`（colors 全段）。新增 gray/gray-alpha/各 accent step + `background-200`。删除零用 boxShadow 工具与 slide-up 动画。
   - 验证：`pnpm typecheck`（无 TS 错，因 className 不变）。
3. **改 `src/index.css` `:root`（light）** → 定义全部 step 变量（灰阶 HSL、gray-alpha、accent HSL）+ `--background-100`/`--background-200` + 语义变量重映射（引用 step）。删除 `--radius`/死规则/`--settings-*` 别名/`--interactive-foreground`。
   - 验证：`pnpm dev` 启动，主窗 light 主题视觉无破坏（语义类底层值已重映射，应与原视觉一致）。
4. **改 `src/index.css` `.dark`** → 同步定义 dark step 变量 + 语义重映射。
   - 验证：`pnpm dev` 切 dark，视觉无破坏。
5. **加 P3 媒体查询** → `@media (color-gamut: p3)` 为所有 accent step 覆盖 oklch 值（从 design.md `*-p3` 段复制）。
   - 验证：在 P3 屏（如 Mac）肉眼核对 accent 饱和度提升；sRGB 屏无变化。
6. **加 typography fontSize token** → `tailwind.config.cjs` `theme.extend.fontSize` 加 28 档命名 token（值从 design.md `typography:` 复制）。
   - 验证：`pnpm typecheck`；临时在某组件试用 `text-heading-16` 确认生成。
7. **加 components 类 + focus ring 工具** → `src/index.css` `@layer components` 加 `.btn-*`/`.input-*`/`.focus-ring`。全局 `*:focus-visible` 改 `outline: none`。
   - 验证：`pnpm dev`，确认现有组件 focus 仍可见（基础组件尚未用 `.focus-ring`，但 shadcn 自带 ring 仍在）。
8. **改 `useTheme.ts`** → accent 写入统一到 `--interactive`/`--ring`；删除 settings 变量写入。
   - 验证：`pnpm dev`，设置页切换 accent，主交互色与 focus ring 跟随变化。
9. **删 `scrollbar-fade` 引用** → `PublishConfigPanel.tsx`、`RepositoryList.tsx` 移除该 className 片段。
   - 验证：`pnpm test`（PublishConfigPanel.test / RepositoryList.test 仍绿）。
10. **grep 校验** →
    - `rg "hsl\(var\(--" tailwind.config.cjs` 应无颜色映射残留（focus ring 等非颜色处可保留）。
    - `rg "scrollbar-fade" src/` 应无结果。
    - `rg "\-\-settings-accent|--settings-sidebar-selected|--settings-card-selected|--settings-hairline|--settings-divider|--settings-ink|--settings-icon" src/` 应无结果。
    - `rg "config-list-row|config-item-selected" src/` 应无结果。
    - 测试锚点保留：`rg "list-scroll-shell|repo-list-grid|geist-scrollbar" src/` 仍在。
11. **全量验证** → `pnpm typecheck && pnpm test && pnpm doctor`。
    - 验证：全绿。
12. **视觉核对** → `pnpm dev`，light/dark 两主题下主窗、设置 Dialog 视觉与改前一致（本任务不改视觉，仅换 token 底层）。

## 完成标准

- 上述 12 步全部通过。
- prd.md Acceptance Criteria 全部勾选。
- 不破坏测试锚点。

## 回滚点

- 步骤 2-7（token 文件改动）为一个回滚单元。
- 步骤 8（useTheme）独立回滚单元。
- 任一步 `pnpm test` 红 → 修复或 `git checkout` 对应文件。
