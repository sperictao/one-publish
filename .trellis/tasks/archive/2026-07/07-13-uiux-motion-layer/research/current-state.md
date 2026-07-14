# 动效与微交互现状（2026-07-13 主会话调研）

## 已有基建（保持，勿重复建设）

- 缓动 token：`ease-geist` = `cubic-bezier(0.175, 0.885, 0.32, 1.1)`（tailwind.config.cjs:254-256）；标准时长 `duration-150`，面板过渡 `duration-200`。
- 自定义 keyframe 仅 1 个：`fade-in`（tailwind.config.cjs:245-253），用于 SettingsDialog.tsx:374 主题选中角标。
- Radix 弹层出入场齐全（tailwindcss-animate）：dialog.tsx:22,76、dropdown-menu.tsx:18、select.tsx:75、tooltip.tsx:22 均有 fade+zoom+slide 出入场。
- 面板折叠已有过渡：CollapsiblePanel.tsx:23 宽度过渡 200ms ease-geist + :35 内容 opacity 过渡。
- 列表重排 FLIP 动效（高质量参照实现）：useListReorderMotion.ts 用 WAAPI，距离自适应时长 150-230ms（`MIN/MAX_MOTION_DURATION_MS`），缓动 `cubic-bezier(0.22,1,0.36,1)`，且消费 useReducedMotion。
- 微交互语言已萌芽：Plus `hover:rotate-90`（RepositoryList.tsx:480）、RefreshCw `hover:rotate-180`（PublishConfigPanel.tsx:1575）、返回箭头 `group-hover:-translate-x-0.5`（RepositoryList.tsx:79）、行操作按钮 `opacity-0 group-hover:opacity-75`（RowActionsMenu.tsx:52）。
- 无 motion / framer-motion / gsap 依赖（package.json 确认）。纯 CSS + WAAPI 栈。

## 缺口

1. **按钮无 tactile 反馈**：button.tsx:7 仅 `transition-colors`；active 态只变 border/bg（:15,:17,:18），无 `active:scale-[0.98]` 类物理反馈。
2. **reduced-motion 覆盖不全**：useReducedMotion 仅被 useListReorderMotion 消费；index.css 无全局 `@media (prefers-reduced-motion: reduce)` 规则，tailwindcss-animate 的出入场动画不受系统设置门控。
3. **发布状态流转瞬时跳变**：PublishRunCard.tsx:115-199 statusMeta 五态切换时 badge/panel/icon 类名直接替换，无颜色/透明度过渡。
4. **折叠区无高度过渡**：警告列表（PublishRunCard.tsx:449 条件渲染）、日志区（:491 `hidden` 切换）、ExecutionHistoryCard 折叠均为瞬时显隐。
5. **重排动效时长/缓动与全局 token 脱节**：useListReorderMotion.ts:4-6 硬编码的缓动曲线与 `ease-geist` 不同（两套曲线并存，无文档说明取舍）。
6. **原型无新动效可吸收**：GeistWorkbenchPrototype 仅 animate-spin，无未吸收的动效模式。
