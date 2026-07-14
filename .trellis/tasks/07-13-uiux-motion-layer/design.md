# 技术设计：动效与微交互层

## D1. 动效 token 单一来源

**问题**：缓动/时长散布三处——tailwind.config.cjs（ease-geist）、useListReorderMotion.ts（硬编码曲线+时长）、各组件 duration-150/200 字面量。

**决策**：根目录新建 `motion-tokens.cjs`（唯一定义处）：

```js
module.exports = {
  easing: {
    geist: "cubic-bezier(0.175, 0.885, 0.32, 1.1)",   // 微过渡：颜色、小位移，轻微回弹
    move:  "cubic-bezier(0.22, 1, 0.36, 1)",          // 空间移动：FLIP、折叠，纯 ease-out
  },
  duration: { fast: 150, normal: 200, moveMin: 150, moveMax: 230 },
};
```

- tailwind.config.cjs `require("./motion-tokens.cjs")` 生成 `transitionTimingFunction.geist/move` 与 duration 扩展。
- useListReorderMotion.ts 通过 `import tokens from "@/../motion-tokens.cjs"` 消费（Vite 原生支持 CJS 互操作；若类型报错则补一个 `motion-tokens.d.ts`）。
- 两条曲线**都保留**，分工成文（微过渡 vs 空间移动），消除"两套曲线无说明"的状态。

## D2. 全局 reduced-motion 门控

index.css 末尾追加标准降级块：

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

覆盖 tailwindcss-animate 出入场、animate-spin（退化为静态图标，可接受）、所有 transition。WAAPI 动画不受 CSS 门控影响，继续由 useReducedMotion 在 JS 层短路（现状已正确）。

## D3. 按钮 tactile

button.tsx 基类追加 `active:scale-[0.98]`，transition 由 `transition-colors` 改为 `transition-[color,background-color,border-color,transform]`（等价通道集合，避免 transition-all）。scale 只作用于自身合成层，不影响相邻布局。icon-only 小按钮（size-6 等）同样适用，无需分档。

## D4. 折叠高度过渡

**方案**：CSS Grid rows 技巧（`grid-template-rows: 0fr → 1fr` + 内层 `overflow-hidden min-h-0`），纯 CSS 可动画、无 JS 测量、无 max-height 魔法数字。

- 新建 `src/components/ui/collapse.tsx`：受控 `open` prop，grid 外层 + overflow 内层，`transition-[grid-template-rows] duration-normal ease-move`。
- 接入点：PublishRunCard 警告列表（:449 条件渲染改常挂载+Collapse）、ExecutionHistoryCard 折叠区。
- 日志区（:487）**不接入**：它是 flex-1 撑满容器的滚动区，参与 grid-rows 动画会与 flex 布局互相干扰；日志折叠保持瞬时（折叠头的 chevron 已有旋转过渡）。此取舍写入代码注释。

## D5. 状态样式过渡

PublishRunCard 状态面板（`<output>`）、badge、icon 容器三处 className 追加 `transition-colors duration-fast ease-geist`。五态切换即获得颜色渐变，零 JS。success/failed 的一次性强调（供 publish-flow 消费）：icon 容器追加 `animate-fade-in`（复用既有 keyframe），key 绑定 publishVisualState 使切换时重放。

## 兼容性说明（破坏性）

- `duration-150/200` 字面量迁移为语义 token 后，旧字面量类名在本任务范围内全部替换，不保留双轨。
