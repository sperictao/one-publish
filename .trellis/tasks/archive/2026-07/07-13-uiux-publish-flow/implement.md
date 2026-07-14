# 执行计划：发布核心流程 UX

前置：motion-layer 完成并归档 → `task.py start 07-13-uiux-publish-flow`。

## 步骤

1. **耗时计时**
   - [ ] `useElapsedTimer.ts`（performance.now 起点，秒级 setState，含单测）
   - [ ] PublishRunCard 接入：running 实时值 / 完成态由 startedAt·finishedAt 推导，展示于 statusFact
   - 验证：mock 发布流转观察计时；`pnpm test src/features/publish/__tests__`

2. **日志分类规则**
   - [ ] `classifyLogLine.ts` + 单测（覆盖 `: error CS1002`、`: warning CS0168`、`error:`、普通行）
   - 验证：`pnpm test -t classifyLogLine`

3. **PublishLogView 抽取**
   - [ ] 从 PublishRunCard 抽出日志滚动区为独立组件（自动跟随 + 回到底部 + 逐行着色 + 复制按钮）
   - [ ] PublishRunCard 改为渲染 `<PublishLogView>`，folding 头保持在外层
   - [ ] 200k 字符性能测量，结果记 journal（超阈值则按 design D3 退化）
   - 验证：组件测试覆盖跟随/暂停/回到底部；`pnpm test`

4. **视图占位**
   - [ ] PublishContentSection home/history fallback 换占位
   - 验证：反复切换无白屏

5. **强调确认**
   - [ ] 确认 success/failed 进入时状态面板强调生效（motion-layer 产物）
   - 验证：mock 三态流转人工过检

6. **收尾**
   - [ ] `pnpm typecheck && pnpm test`；发布 e2e spec 不回归
   - [ ] journal 记录性能测量与验证

## 回滚点

步骤 3 是最大改动（抽组件），单独提交便于回滚；1/2 是纯新增模块，风险低。
