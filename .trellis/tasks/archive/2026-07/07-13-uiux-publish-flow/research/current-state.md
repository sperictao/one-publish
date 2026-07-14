# 发布核心流程 UX 现状（2026-07-13 主会话调研）

## 已有能力（保持）

- 状态机完整：PublishRunCard.tsx:115-199，五态 idle/running/success/cancelled/failed，每态有 badge/panel/icon 样式与 i18n 描述文案。
- 状态面板 `aria-live="polite"`（PublishRunCard.tsx:347）。
- 结果时刻已结构化：成功摘要（文件数 :203-206）、可点击输出目录行（:392-418）、失败消息块（:420-427）、警告折叠列表（:430-462，近期「结构化日志警告」产出）。
- 日志性能保护：usePublishLogStream.ts MAX_VISIBLE_LOG_CHARS=200k 尾部截断、按行对齐。
- 完成反馈链路：usePublishNotify.ts 有 toast/系统通知双通道、托盘状态同步（setTrayPublishStatus）、自动打开输出目录选项。
- 日志有结果时默认折叠、running 时展开（:210-213 有明确设计注释）。

## 缺口

1. **running 态无过程感知**：仅 Loader2 spinner + 静态文案（:126-140）。无已耗时计时、无阶段感知（restore/build/publish）、无任何进度指示。dotnet publish 常跑 30s-数分钟，这是体验最大空洞。
2. **日志区是裸 `<pre>`**（:487-498）：
   - 无自动跟随滚动（新日志到来时不会滚到底部，用户需手动滚）；
   - 无行级 error/warning 着色（警告只在完成后汇总，运行中日志全部单色）；
   - 无复制日志按钮；
   - 长日志无虚拟滚动（200k 字符裸渲染在 `<pre>` 中）。
3. **状态切换瞬时跳变**：与 motion-layer 缺口 3 相同，success/failed 的关键时刻没有任何过渡强调。
4. **视图切换闪空**：PublishContentSection.tsx:46,61 home/history 懒加载 Suspense fallback=null，首次切换白屏闪烁。
5. **isRefreshing 遮罩**（:501-509）是全卡片覆盖 + spinner，与骨架屏体系缺失相关（见 state-completeness 任务）。
6. 历史卡 ExecutionHistoryCard.tsx（306 行）有 Loader2（:179），空态/详情体验依赖 i18n `noHistoryToExport` 等文案，无结构化空态设计。
