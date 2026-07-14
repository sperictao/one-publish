# 发布核心流程 UX 升级

## Goal

补齐发布「进行中」的过程感知与日志可读性：耗时计时、日志自动跟随、行级警告/错误着色、日志复制；强化成功/失败时刻的反馈。发布是本工具的核心价值时刻，这里的体验密度应当最高。

## 前置事实

见 [research/current-state.md](research/current-state.md)。核心结论：结果时刻（成功摘要/输出目录/警告汇总）近期已结构化，最大空洞是 running 态只有一个 spinner，以及日志区是无跟随、无着色的裸 `<pre>`。

## Requirements

1. **运行耗时计时**：running 态在状态面板显示已耗时（mm:ss，每秒更新）；完成后耗时由 `ExecutionRecord.startedAt/finishedAt` 推导并固化显示在结果摘要中（字段已存在，无需新增持久化）。
2. **日志自动跟随**：日志追加时自动滚动到底部；用户手动上滚后暂停跟随，出现「回到底部」浮动按钮，点击恢复跟随。
3. **行级着色**：对日志行做轻量模式匹配（error/warning/`error CS`/`warning CS` 等 .NET 诊断格式），错误行 destructive 色、警告行 warning 色。注意：完成态警告汇总由 Rust 侧提取（`PublishResult.warnings`），前端无法字面复用；约束为前端规则**只存在一个模块**，并以注释标明与 Rust 提取语义的对齐点。
4. **日志复制**：日志区头部提供复制全量日志按钮（消费 getOutputLogSnapshot 的完整日志而非可见截断层），带成功 toast。
5. **视图切换不闪空**：PublishContentSection home/history 的 Suspense fallback 由 null 改为轻量占位（与 state-completeness 任务的骨架体系衔接；本任务先落最小占位，避免白闪）。
6. **成功/失败时刻强调**：状态面板进入 success/failed 时有一次性过渡强调（消费 motion-layer 的状态过渡产出，不自行造动效）。

## 非目标

- 不做阶段解析（restore/build/publish 里程碑）：dotnet CLI 输出无稳定契约，解析易碎，YAGNI。耗时计时已提供过程感知。
- 不引入虚拟滚动库：现有 200k 字符截断已控制上限，行级着色按行拆分后若性能不达标再评估（在 design.md 记录测量点）。
- 不改发布事件后端契约（Rust 侧不动）。

## 依赖

- 状态过渡样式依赖 07-13-uiux-motion-layer 的动效 token 产出；实施顺序在 motion-layer 之后。

## Acceptance Criteria

- [ ] 发布运行中可见已耗时，完成后耗时保留在摘要中。
- [ ] 日志自动跟随 + 手动上滚暂停 + 回到底部按钮，行为经组件测试覆盖。
- [ ] 错误/警告行着色规则与警告汇总提取共享同一定义，单测覆盖典型 .NET 诊断行。
- [ ] 复制按钮复制的是完整日志（含被截断部分）。
- [ ] home/history 切换无白屏闪烁。
- [ ] 200k 字符日志下滚动与追加无可感知卡顿（手工验证记录于任务 journal）。
- [ ] `pnpm typecheck`、`pnpm test` 全绿，发布相关 e2e spec 不回归。
