# Geist UI 基础组件对齐

## Goal

`src/components/ui/**` 16 个基础组件改用子任务 1 落地的 Geist token 与 typography，对齐 design.md components token 的 variant/size/height/radius，统一 focus ring，消除手写魔数。

## 前置

依赖子任务 1（geist-token-system）交付的 token 体系。

## Requirements

- 16 个组件（button/input/textarea/card/dialog/select/dropdown-menu/switch/label/tooltip/sonner/section-shell/app-dialog-shell/app-dialog-badge/app-dialog-inset/help-tip）改用：
  - typography fontSize token（`text-heading-16`/`text-label-14`/`text-button-14` 等）替代 `text-sm`/`text-[18px]`/`text-lg`。
  - step token 或语义类替代硬编码（`bg-black/50` overlay → token 化的遮罩色）。
  - components 类（`.btn-*`/`.input-*`）对齐 Button/Input 的 variant/size/height/radius/padding。
- 统一 focus ring：所有可聚焦基础组件用 `.focus-ring` 工具，消除 `focus-visible:ring-2 ...` 与全局 outline 的叠加。
- 对齐 design.md components token：button primary/secondary/tertiary/error + small/large，input base/small/large 的 height(40/32/48)、radius(sm=6)、padding。
- 保留组件现有 API（variant/size/className prop 不变）。
- 测试锚点保留（`[overflow-wrap:anywhere]` 字面量若在 ui 组件则保留；实际该字面量在 PublishRunCard，属子任务 3）。

## Acceptance Criteria

- [ ] `src/components/ui/**` 无手写 `text-[Npx]`/`tracking-[...]`/`text-lg`/`text-sm` 魔数（改用 fontSize token）。
- [ ] Button/Input variant/size 对齐 design.md components token（height/radius/padding）。
- [ ] 所有可聚焦基础组件统一 `.focus-ring`，无双层 ring 叠加。
- [ ] 组件 API（variant/size/className）不变。
- [ ] `pnpm typecheck && pnpm test` 全绿。

## Notes

- design.md/implement.md 在本任务 `task.py start` 前补齐（复杂任务）。
- 视觉应与 design.md components 段一致，而非与改前一致（本任务允许视觉微调以对齐设计系统）。
