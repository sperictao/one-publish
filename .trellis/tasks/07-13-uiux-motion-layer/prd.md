# 动效与微交互层升级

## Goal

在现有 `ease-geist` + WAAPI 基建上补齐交互反馈的缺口，让全应用动效遵循同一套 token 与 reduced-motion 门控，消除状态跳变与折叠跳变。

## 前置事实

见 [research/current-state.md](research/current-state.md)。核心结论：基建已存在（ease-geist、Radix 出入场、FLIP 重排），缺的是 tactile 反馈、reduced-motion 全局门控、状态/折叠过渡、以及两套缓动曲线的统一。

## Requirements

1. **动效 token 统一（DRY）**：在 tailwind.config.cjs 沉淀时长与缓动语义 token（如快/标准/慢三档时长），useListReorderMotion.ts 的硬编码曲线与时长改为消费同一来源；两套曲线并存需二选一或书面说明分工。
2. **全局 reduced-motion 门控**：index.css 增加 `@media (prefers-reduced-motion: reduce)` 全局规则，将 tailwindcss-animate 出入场与所有 transition 降级为瞬时；useReducedMotion 保持供 JS 动画（WAAPI）消费。
3. **按钮 tactile 反馈**：button.tsx 增加 `active:` 物理反馈（scale 或 translate，幅度克制，符合 Geist 气质），transition 通道相应扩展；禁止影响 layout 的属性。
4. **折叠区高度过渡**：为警告列表（PublishRunCard）、日志折叠、ExecutionHistoryCard 折叠提供统一的展开/收起过渡方案（实现方式在 design.md 定夺），reduced-motion 下退化为瞬时。
5. **状态样式过渡**：PublishRunCard statusMeta 五态切换时，badge/panel/icon 颜色以 transition 过渡，不新增 JS。

## 非目标

- 不引入 motion/framer-motion/gsap（现有 CSS + WAAPI 栈已足够，桌面工具无需营销级动效）。
- 不改动 Radix 弹层现有出入场参数。
- 不做无目的的常驻动画（呼吸、浮动、shimmer 常亮等）。

## Acceptance Criteria

- [ ] 所有新增/改动动效只使用 transform/opacity/color 通道。
- [ ] 系统开启「减弱动态效果」后：出入场、折叠、tactile、FLIP 全部瞬时化，功能无损（人工验证 + 单测覆盖 useReducedMotion 消费点）。
- [ ] 动效时长/缓动全部来自共享 token，`grep cubic-bezier src/` 仅命中 token 定义处。
- [ ] 按钮按压有可感知反馈且不引起相邻布局位移。
- [ ] 警告/日志/历史折叠展开有平滑过渡，无内容闪跳。
- [ ] `pnpm typecheck`、`pnpm test` 全绿；现有 reorder 动效测试不回归。
