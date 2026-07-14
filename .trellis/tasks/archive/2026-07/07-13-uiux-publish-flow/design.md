# 技术设计：发布核心流程 UX

## 事实确认（调研落实）

- `PublishResult.warnings: Array<string> | null` 由 Rust 侧提取（tauri-contracts.ts:46），前端只消费，PublishRunCard.tsx:226 已 filter。
- `ExecutionRecord` 有 `startedAt` / `finishedAt`（ISO 字符串，tauri-contracts.ts:104），耗时可推导，无需新字段。
- 日志层：usePublishLogStream 有 `getOutputLogSnapshot()`（完整日志）与 `outputLog`（可见截断层，200k）。

## D1. 耗时计时

新建 `src/features/publish/useElapsedTimer.ts`：
- 入参 `active: boolean`；active 变 true 时记起点（用 `performance.now()`，非渲染值），每秒 setState 更新 `elapsedMs`；active 变 false 停止。
- reduced-motion 无关（计时非动效）。
- 完成态：PublishRunCard 从 `publishResult` 对应的 record 推导 `finishedAt - startedAt`；running 态用 useElapsedTimer 实时值。
- 展示：`mm:ss`，接入状态面板 statusFact 行（成功态"N 个文件 · 用时 mm:ss"）。

## D2. 日志自动跟随 + 回到底部

日志容器（PublishRunCard.tsx:487 的滚动 div）逻辑抽到 `src/components/publish/PublishLogView.tsx`：
- `followRef` 状态：追加时若 `follow` 为真，`scrollTop = scrollHeight`。
- onScroll：判断是否贴底（`scrollHeight - scrollTop - clientHeight < 8px`）→ 贴底则 follow=true，否则 false。用 rAF 节流，**不**用 window scroll 监听（容器级 onScroll 合规）。
- follow=false 时右下角浮现「回到底部」按钮（ArrowDown 图标，surface-raised 药丸），点击 → 滚到底 + follow=true。按钮出入场用 motion-token 的 fade。

## D3. 行级着色

新建 `src/features/publish/classifyLogLine.ts`（**唯一**规则模块）：
```ts
export type LogLineLevel = "error" | "warning" | "plain";
// 匹配 .NET 诊断：/: error [A-Z]{1,4}\d+/、/: warning [A-Z]{1,4}\d+/、
// 行首 error:/warning:（大小写不敏感）。注释标明与 Rust warnings 提取的语义对齐。
export function classifyLogLine(line: string): LogLineLevel
```
PublishLogView 按 `\n` 拆分逐行渲染 `<span>`，error→text-destructive、warning→text-warning、plain→继承。
性能：拆分 + map 在 200k 字符/上千行时测量首屏与追加帧时间（design 记录测量点，超 16ms/帧则退化为仅尾部着色或引入分块）。

## D4. 日志复制

PublishLogView 头部加复制按钮：`navigator.clipboard.writeText(getOutputLogSnapshot())`（完整日志，非可见层）→ 成功 toast（复用 sonner 与 i18n）。图标按钮补 aria-label。

## D5. 视图切换占位

PublishContentSection.tsx:46,61 fallback `null` → 轻量占位（`<div className="p-4"><Skeleton.../></div>`，消费 state-completeness 的骨架原语；若该任务未先行，先用 min-h 占位 div 防白闪，注释标记待接骨架）。

## D6. 成功/失败强调

消费 motion-layer D5 的状态过渡（PublishRunCard 已在 motion-layer 接入 transition-colors + icon fade-in 重放）。本任务不重复造，只确认 success/failed 进入时视觉强调生效。

## 依赖顺序

motion-layer（token + 状态过渡 + Collapse）先行 → 本任务消费其产物。
