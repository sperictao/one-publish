# Implement — Geist UI 基础组件对齐

## 步骤

1. **基线** → `pnpm typecheck && pnpm test` 全绿（子任务 1 后基线）。
2. **button.tsx** → cva 数值对齐 components token（default `h-10 px-2.5`、sm `h-8 px-1.5`、lg `h-12 px-3.5 text-button-16`）；`text-sm font-medium`→`text-button-14 font-medium`；focus 串替换为 `.focus-ring`。保留 variant 语义类与 API。
   - 验证：`pnpm typecheck`。
3. **input.tsx / textarea.tsx** → `text-sm`→`text-label-14`；其余（surface-input h-10 px-3）保留。
4. **card.tsx** → CardTitle `text-[18px] font-semibold leading-none`→`text-heading-20 font-semibold`；CardDescription `text-sm`→`text-copy-14`；p-6 保留。
5. **dialog.tsx** → DialogTitle `text-lg font-semibold leading-none`→`text-heading-20 font-semibold`；DialogDescription `text-sm`→`text-copy-14`；Close 按钮 focus 串→`.focus-ring`；overlay `bg-black/50` 保留。
6. **select.tsx** → trigger/item `text-sm`→`text-label-14`；SelectLabel `text-sm font-semibold`→`text-label-14 font-semibold`；content rounded-md 保留。
7. **dropdown-menu.tsx** → DropdownMenuItem `text-xs`→`text-label-13`；focus 串→`.focus-ring`。
8. **switch.tsx** → focus 串→`.focus-ring`；尺寸/填色保留。
9. **label.tsx** → `text-sm font-semibold leading-none`→`text-label-14 font-semibold`（去 leading-none）。
10. **tooltip.tsx** → `text-sm`→`text-label-14`。
11. **sonner.tsx** → 检查 classNames，语义类保留（无需改 token）；若有无 token 的字号则对齐。
12. **section-shell.tsx** → 标题 `text-sm font-semibold`→`text-heading-14 font-semibold`；描述 `text-[11px] leading-4 text-[hsl(var(--text-fine))]`→`text-label-12 text-[hsl(var(--text-fine))]`（保留 raw --text-fine，去 leading-4）；badge `text-[10px]`→`text-label-12`；图标徽保留。
13. **app-dialog-shell.tsx** → title `text-[18px] font-semibold`→`text-heading-20 font-semibold`；其余（图标 h-10 w-10、间距、size 字典）保留。
14. **app-dialog-badge.tsx** → `text-[11px] font-semibold`→`text-label-12 font-semibold`。
15. **app-dialog-inset.tsx** → 检查无字号魔数（rounded-md border p-4 保留）。
16. **help-tip.tsx** → focus 串→`.focus-ring`；size-4 rounded-full 保留。
17. **grep 校验** →
    - `rg "text-\[" src/components/ui/` 应无残留（section-shell 的 `text-[hsl(var(--text-fine))]` 是刻意保留，白名单）。
    - `rg "text-lg|text-xs" src/components/ui/` 应无残留。
    - `rg "text-sm" src/components/ui/` 核对每处是否已替换或属白名单。
    - 测试锚点：`rg "list-scroll-shell|geist-scrollbar" src/components/ui/` 保留（app-dialog-shell 等用 geist-scrollbar）。
18. **全量验证** → `pnpm typecheck && pnpm test && pnpm doctor`。
19. **视觉核对** → `pnpm dev`，light/dark 核对 Button/Input/Dialog/Card/Select/Dropdown/Switch/Tooltip 视觉与 design.md 一致；确认 focus ring 单层（无 outline 叠加）。

## 完成标准

- 16 个组件无手写字号魔数（白名单：section-shell 的 `text-[hsl(var(--text-fine))]`、overlay `bg-black/50`、`text-white`/`text-black` 标准色）。
- Button/Input 对齐 design.md components token。
- 所有可聚焦组件统一 `.focus-ring`。
- `pnpm typecheck && pnpm test && pnpm doctor` 全绿。

## 回滚点

- 每个组件独立编辑，任一组件致 test 红 → `git checkout` 该文件。
