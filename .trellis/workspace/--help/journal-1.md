# Journal - --help (Part 1)

> AI development session journal
> Started: 2026-06-02

---



## Session 1: 修复 profile 选中身份跨仓库切换持久化

**Date**: 2026-06-02
**Task**: 修复 profile 选中身份跨仓库切换持久化
**Branch**: `main`

### Summary

将 activeProfileName 从本地 state 重构为由 selectedPreset 的 userprofile:* key 派生，确保仓库切换后自动恢复自定义 profile 选中状态。同步修改 useProfileCrud 在创建/应用时写入 setSelectedPreset，更新规范文档，新增跨仓库切换恢复与普通自定义不自带旧选择的测试用例。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `fe9326b` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 2: 实现仓库添加时 provider 列表为空仍自动绑定项目文件 + UI i18n 提取重构

**Date**: 2026-06-03
**Task**: 实现仓库添加时 provider 列表为空仍自动绑定项目文件 + UI i18n 提取重构
**Branch**: `main`

### Summary

feat(repository): provider 列表为空时回退 API 查询以自动绑定项目文件。refactor(ui): 提取硬编码 i18n 字符串，EditRepositoryDialog 改用 key 驱动重挂载。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `d3394df` | (see git log) |
| `028dca2` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 3: Geist token 体系重构与全页面组件迁移

**Date**: 2026-06-21
**Task**: Geist token 体系重构与全页面组件迁移
**Branch**: `main`

### Summary

重构 Geist 设计 token 体系为 step token + 语义别名双层结构（sRGB HSL 回退叠加 P3 oklch），并在 tailwind-merge 注册 typography class group 防止 color 工具类被误剥离。将 ui/layout/publish/release/environment 全量组件迁移到 step token 与 heading/button/label/copy typography 工具类，按钮引入 focus-ring 共享类、Input 新增 bare 模式。新增 dev-only Geist 工作台原型路由（?variant=A），并补充 e2e 用例。归档 06-21 三个 Geist 任务。注意：typecheck/react-doctor/browser smoke 验证未执行，留待后续。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `1e49e9b` | (see git log) |
| `9f59dfb` | (see git log) |
| `401ac85` | (see git log) |
| `cd1da79` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete

## 2026-07-13 UI/UX 全面升级规划（Phase 1）

- 用户确认四方向全选（动效/发布流程/状态完整性/细节收口），同意创建 Trellis 任务。
- 建任务树：父 07-13-uiux-comprehensive-upgrade + 四子任务。执行顺序：motion-layer → publish-flow → state-completeness → detail-polish。
- 调研遇子代理持续 429 限流，改为主会话内串行 grep 调研，事实清单落各子任务 research/current-state.md。
- 关键事实：ease-geist token 体系已在；零骨架屏；aria-live 仅 1 处；warnings 由 Rust 提取；ExecutionRecord 已有 startedAt/finishedAt。
- 产出：父 prd + 4 子 prd + motion-layer/publish-flow 的 design+implement。P2 两任务的 design/implement 待其激活前编写（依赖前序产物）。
- 状态：待用户审阅规划 → task.py start 07-13-uiux-motion-layer。

## 2026-07-14 motion-layer 实施（Phase 2）

- 步骤1 token：单一来源最终形态是 motion-tokens.json（初版 .cjs 被 Vite 原样下发导致 `module is not defined` 崩溃，浏览器验证时发现并改为 JSON；require 与 ESM 均原生支持，tsconfig 已有 resolveJsonModule）。tailwind ease-geist/ease-move + fade-in 时长、useListReorderMotion、index.css surface-input（改 @apply）全部消费 token；grep cubic-bezier 仅命中 token 文件。
- 步骤2 reduced-motion：index.css 末尾全局降级块（animation/transition 0.01ms），WAAPI 仍由 useReducedMotion 短路。
- 步骤3 tactile：button.tsx enabled:active:scale-[0.98]，transition 通道扩为 color/bg/border/transform。取舍：asChild 渲染为 <a> 时 :enabled 不匹配、无 tactile，可接受。浏览器验证 computed style：transition-property/timing 正确。
- 步骤4 Collapse：新增 ui/collapse.tsx（grid-rows 0fr↔1fr + inert）+ 2 单测；PublishRunCard 警告列表接入。取舍：ExecutionHistoryCard 保留原生 <details>（受控化需每记录加状态，不划算），顺手修复其 chevron 缺 group 类导致旋转从未生效的存量 bug。
- 步骤5 状态过渡：PublishRunCard 状态面板/badge/icon 容器 transition-colors；icon 按 publishVisualState 重放 animate-fade-in。
- 验证：typecheck ✅；src 测试 516 passed，唯一失败位于 .claude/worktrees/advisor-geist 遗留 worktree 副本（vitest glob 误扫，非源码问题，待用户决定是否清理）；doctor ✅；浏览器验证 reduced-motion 规则与 ease-move 已进产物 CSS。

## 2026-07-14 publish-flow 实施（Phase 2）

- 步骤1 计时：useElapsedTimer（performance.now + setInterval）+ formatElapsed，单测覆盖。hook 必须置于 PublishRunCard 早退之前（hooks 规则），用 publishActions.isPublishing 判定 running。完成后组件不卸载故保留末值。展示于状态面板 statusFact："N 个文件 · 用时 mm:ss"。
- 步骤2 日志分类：classifyLogLine 唯一规则模块（.NET 诊断码 + 行首前缀），单测覆盖误判边界（"0 Error(s)" 不误判）。与 Rust warnings 提取语义对齐但各自独立（注释说明）。
- 步骤3 PublishLogView：抽独立组件，逐行着色 + 自动跟随（followRef + onScroll 贴底判定，容器级监听非 window）+ 回到底部浮钮 + 复制完整快照。getOutputLogSnapshot 从 usePublishRunner→usePublishBoot→usePublishRunCardProps→PublishRunCard 四层贯穿。组件测试覆盖着色/复制完整快照/默认跟随不显浮钮。
- 步骤4 视图占位：PublishContentSection 两处 Suspense fallback 由 null 改 animate-pulse 占位块。
- i18n：新增 copyLogLabel/copyLogSuccess/publishLogJumpToBottom/publishElapsedLabel（zh+en），check:i18n 100%。
- 验证：typecheck ✅、src 测试 272 passed、check:i18n 100%、doctor ✅、浏览器确认终端色/fade-in/clipboard API 就绪。真实发布渲染需 Tauri 后端，纯 Vite 无法驱动，故行为逻辑靠单测覆盖。

## 2026-07-14 state-completeness 实施（Phase 2）

- 骨架原语：新增 ui/skeleton.tsx（gray-alpha + pulse，reduced-motion 由全局规则静止）；layout/PanelSkeleton.tsx（标题条+搜索条+5 行列表形状）。
- 空态统一：新增 ui/empty-state.tsx（图标容器+标题+可选 hint+可选 action，基准取自仓库列表空态）+ 单测。迁移 RepositoryList（h-full）、ShortcutsDialog、PublishConfigPanel「暂无配置」（原一行灰字→EmptyState）。ConfigDialog 空态已有图标+文案且被 AppDialogInset 包裹，迁移收益低，保留。
- Suspense fallback：App.tsx 左/中栏懒加载 fallback 由空白 div 改 PanelSkeleton；PublishContentSection 两处 fallback 由 null 改 animate-pulse 占位。dev-only Geist 原型与主内容区 fallback 保留（前者非产品路径，后者内容型骨架形状不匹配，YAGNI）。
- spinner 收敛：行内操作（刷新图标、按钮内）保留 spinner；区域级加载改骨架。准则：行内 spinner / 区域骨架。
- 错误态审计结论：provider 检测失败有 toast.error（useRepositoryActions.runtime.ts:153）、环境检查失败有 toast.error（EnvironmentCheckDialog.tsx:188）。初始化元数据的 scanProjectCandidates/scanRepositoryBranches 的 .catch(()=>null) 是渐进增强容错（扫描失败不阻断加仓库，降级由空分支列表/连通性标记呈现），是设计意图非静默缺陷。无需补路径。
- 验证：typecheck ✅、src 测试 274 passed、doctor ✅、浏览器明暗双主题确认仓库/配置空态视觉统一。

## 2026-07-14 detail-polish 实施（Phase 2）

- 范围调整（基于实测发现）：
  - 「tooltip 带 kbd」大幅缩减。实测 Tooltip 组件全应用仅 help-tip.tsx 使用，界面按钮用原生 title= 而非 Radix Tooltip；快捷键数据是运行时从 Rust get_shortcuts_help 拉取。铺 tooltip+kbd 需新建大量触点 + 依赖后端，属新增功能非收口，违反 YAGNI，暂缓（记为后续候选）。
  - aria-label：PublishRunCard/PublishLogView 的按钮多带可见文本（执行/取消/输出目录/复制已有 aria-label），有可见文本即有可访问名，非缺陷。research「0 处 aria-label」是统计口径问题。
- 实做项：
  - aria-live：PublishLogView 日志滚动区加 role="log" + aria-live（active 时 polite，否则 off）+ aria-relevant="additions"，读屏用户可感知发布进度追加。
  - 微文案统一：zh.json 直角引号 “”（4 对）全部统一为方角「」，与既有 5 处「」一致。JSON 合法性 + check:i18n 100% 验证通过。
- 未做（超范围/低收益，记为后续候选）：HelpTip 布局层补位、低对比 token WCAG 精确测算、tracking 工具类提取、完整读屏走查。
- 验证：typecheck ✅、src 测试 274 passed、check:i18n 100%、doctor ✅。
