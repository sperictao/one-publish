# 执行计划：动效与微交互层

前置：`python3 ./.trellis/scripts/task.py start 07-13-uiux-motion-layer` 之后才可动代码。

## 步骤

1. **token 落地**
   - [ ] 新建 `motion-tokens.cjs` + tailwind.config.cjs 接入（easing.geist/move、duration.fast/normal）
   - [ ] useListReorderMotion.ts 改为消费 token（删除本地 MIN/MAX/MOTION_EASING 常量）
   - 验证：`pnpm typecheck` && `pnpm test src/components/layout/__tests__ -t reorder`；`grep -rn "cubic-bezier" src/ tailwind.config.cjs` 仅命中 motion-tokens.cjs

2. **reduced-motion 全局门控**
   - [ ] index.css 追加 `@media (prefers-reduced-motion: reduce)` 降级块
   - 验证：dev 模式下开启系统减弱动态效果，对话框/下拉/spinner/面板折叠全部瞬时化

3. **按钮 tactile**
   - [ ] button.tsx 基类 `active:scale-[0.98]` + transition 通道扩展
   - 验证：`pnpm test src/components/ui/__tests__`；人工按压各 variant 无布局位移

4. **Collapse 组件与接入**
   - [ ] 新建 `src/components/ui/collapse.tsx`（grid-rows 方案，含单测：open 切换渲染语义）
   - [ ] PublishRunCard 警告列表接入；ExecutionHistoryCard 折叠接入
   - [ ] 日志区不接入的取舍写为代码注释
   - 验证：`pnpm test`；人工展开/收起无闪跳；reduced-motion 下瞬时

5. **状态过渡**
   - [ ] PublishRunCard 状态面板/badge/icon 追加 transition-colors；icon 容器状态切换重放 fade-in
   - 验证：mock 发布流转 idle→running→success 观察渐变；`pnpm test src/components/publish/__tests__`

6. **收尾**
   - [ ] `pnpm typecheck && pnpm test && pnpm doctor`
   - [ ] duration 字面量清理核对（`grep -rn "duration-150\|duration-200" src/` 与 token 对照）
   - [ ] journal 记录取舍与验证结果

## 回滚点

每步独立可回滚；步骤 1 是后续步骤的依赖，其余步骤间无耦合。
