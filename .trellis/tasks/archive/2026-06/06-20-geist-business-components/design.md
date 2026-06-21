# Design — Geist 业务组件与页面重构

承接父任务 `design.md` 与子任务 1/2。本文件定义 `src/components/{layout,publish,environment,release}/**` + `src/App.tsx` 的手写魔数消除原则、字号档位决策、白名单与测试锚点保留清单。实施以 design.md / design.dark.md 为最终准绳。

## 1. 映射原则

- **字号魔数全消除**：`text-[Npx]`/`text-xs`/`text-sm`/`text-lg`/`text-base` → typography token。标题→heading，单行标签/元数据/路径/名→label，正文/描述→copy，按钮→button。
- **字距魔数消除**：`tracking-[-0.224px]`/`tracking-[-0.12px]`/`tracking-[0.18em]`/`tracking-[0.15em]` 等 → 由 typography token 自带 letterSpacing 承载；eyebrow 的正字距统一到 §3 白名单约定。
- **字重**：`font-bold`→`font-semibold`；`font-normal`/`font-medium`/`font-semibold` 保留。
- **手写行高**：`leading-[1.4]`/`leading-none`/`leading-4/5/6` → 由 token lineHeight 承载，删除手写。
- **颜色**：保留语义类（底层已是 Geist step）。硬编码 hex 仅在 SettingsDialog accent 调色板数据（`#006bff` 等，由 useTheme 消费，非样式）——保留。
- **魔数尺寸**：布局尺寸（`pl-[100px]` 折叠占位、`sm:max-w-[560px]` dialog 宽、`min-h-[80px]`、`h-[82vh]` 等）保留为「必要任意值」白名单；状态/装饰小尺寸（`h-[18px]` count chip 等）按场景归并到 step 或保留并注明。
- **半步 spacing**（`gap-1.5`/`p-2.5`/`space-y-1.5` 等）：不强制全改，仅明显偏离 Geist 节奏（8/16/32）处归并；多数半步在密集列表行中合理，保留。
- **测试锚点不可破坏**（§5）。
- **不动业务逻辑**：仅替换视觉 className。

## 2. 字号档位决策表

| 场景 | 原 className | 新 token |
|---|---|---|
| 区块/分类标题（`text-[15px]`/`text-[17px]` font-semibold） | `text-[15px]`/`text-[17px] font-semibold tracking-[-0.3px]` | `text-heading-16 font-semibold`（统一到 heading-16） |
| 卡片/行主名（仓库名 `text-[13px]`、profile 名 `text-[13px]`） | `text-[13px] font-semibold tracking-tight` | `text-label-13 font-semibold`（去 tracking-tight，label-13 无字距） |
| 行次级/路径（`text-[11px]`） | `text-[11px] text-muted-foreground` | `text-label-12 text-muted-foreground` |
| SettingsDialog 标题串（`text-[14px] font-semibold tracking-[-0.224px]`，13+ 处） | 同左 | `text-heading-14 font-semibold`（tracking -0.28px 替代 -0.224px） |
| SettingsDialog 描述串（`text-[12px] leading-[1.4] tracking-[-0.12px]`，13+ 处） | 同左 | `text-label-12 text-muted-foreground`（去 leading/tracking） |
| 侧栏分类项（`text-[13px] font-semibold tracking-[-0.12px]`） | 同左 | `text-label-13 font-semibold` |
| eyebrow（`text-[12px]/text-[10px] font-semibold uppercase tracking-[0.18em]/[0.15em]`） | 同左 | `text-label-12 font-semibold uppercase tracking-[0.15em]`（统一 0.15em，白名单正字距） |
| 状态 eyebrow（PublishRunCard `text-[12px] font-semibold uppercase tracking-[0.18em]`） | 同左 | `text-label-12 font-semibold uppercase tracking-[0.15em]` |
| provider 徽章（`text-[10px] font-bold`） | 同左 | `text-label-12 font-semibold`（10px→12px，bold→semibold） |
| count chip（`text-[18px]` 等） | `text-[18px]` | `text-label-18 font-semibold` |
| 正文/描述（`text-sm`） | `text-sm` | `text-copy-14` 或 `text-label-14`（单行→label，多行→copy） |
| 表单 label（`text-sm font-semibold`） | 同左 | `text-label-14 font-semibold` |
| 按钮（`text-sm font-medium`） | 同左 | `text-button-14 font-medium` |
| `text-xs`（小元数据） | `text-xs` | `text-label-12` |
| `text-base`/`text-lg` | `text-base`/`text-lg` | `text-heading-16`/`text-heading-20` |

## 3. 白名单（保留不改）

- **测试锚点 className 字面量**：`[overflow-wrap:anywhere]`、`pl-3`、`pl-10`（PublishRunCard/PublishConfigPanel/RepositoryRow）。**这些必须逐字保留**。
- **测试锚点 CSS 类**：`.list-scroll-shell`、`.repo-list-grid`、`.geist-scrollbar`。
- **eyebrow 正字距**：`tracking-[0.15em]` 作为 eyebrow 约定白名单（design.md 无 eyebrow token，统一到此值）。
- **布局尺寸任意值**：`pl-[100px]`、`sm:max-w-[560px]/[580px]/[640px]/[720px]/[920px]/[960px]/[78vw]`、`h-[82vh]`、`h-[calc(100vh-11rem)]`、`min-h-[80px]`、`min-h-[360px]/[520px]/[640px]`、`max-h-[82vh]/[85vh]/[min(82vh,680px)]`、`min-w-[8rem]/[13rem]`、`sm:w-[180px]/[100px]`、`md:w-[220px]` 等。保留并视为布局必要。
- **`text-[hsl(var(--text-fine))]`**：raw --text-fine 消费保留（仅改其字号到 token）。
- **`bg-[hsl(var(--terminal-bg))]`/`text-[hsl(var(--terminal-fg))]`**（PublishRunCard 终端面板）：保留（刻意深色）。
- **`var(--theme-preview-*)`**（ThemePreviewMock）：保留（刻意并排 light+dark）。
- **SettingsDialog accent 调色板 hex 数据**（`#006bff` 等）：保留（useTheme 数据源，非样式）。
- **`data-*`/aria/文案**：保留。

## 4. 分组与重点

### layout/（17 组件）
- SettingsDialog：13+ 处 `text-[14px] font-semibold tracking-[-0.224px]` 与 `text-[12px] leading-[1.4] tracking-[-0.12px]` 重复串统一（最大收益）。分类标题 `text-[15px]/[17px]`→heading-16。
- PublishConfigPanel：eyebrow `text-xs font-semibold uppercase tracking-wider`→label-12 uppercase tracking-[0.15em]；profile 名 `text-[13px]`→label-13；保留 `pl-3`/`pl-10`/`list-scroll-shell`。
- RepositoryList：品牌 eyebrow `text-[10px] tracking-[0.15em]`→label-12 tracking-[0.15em]；保留 `repo-list-grid`。
- RepositoryRow：仓库名 `text-[13px]`→label-13；路径 `text-[11px]`→label-12；provider 徽章 `text-[10px] font-bold`→label-12 font-semibold；保留 `pl-3`/`pl-10`/`data-list-item-id`/`aria-pressed`。
- 其余（MainContentShell/SidebarPanelShell/BranchPanel/EditRepositoryDialog/ShortcutsDialog/ProviderRuntimeBanner/各 RowActionsMenu/ListReorderControls/ResizeHandle/CollapsiblePanel/PublishContentSection/ThemePreviewMock/topbarButtonStyles）：逐处替换字号魔数，保留布局尺寸与锚点。

### publish/（18 组件）
- PublishRunCard：状态 eyebrow `text-[12px] tracking-[0.18em]`→label-12 tracking-[0.15em]；命令预览/日志 `font-mono text-xs`→`font-mono text-label-12`；保留 `[overflow-wrap:anywhere]`/`bg-[hsl(var(--terminal-bg))]`/`text-[hsl(var(--terminal-fg))]`/`data-testid`。
- DotnetPublishConfigFormSections：29 处字号热点，逐处替换。
- 其余（ConfigDialog/QuickCreateProfileDialog/CommandImportDialog/CommandImportResultCard/ProjectPublishProfileViewerDialog/RerunChecklistDialog/ExecutionHistoryCard/ArtifactActions/OutputTargetBadge/DiagnosticsSection/Parameter* /ReadonlyParameterFieldsSection）：逐处替换，保留 aria name（测试锚定）。

### environment/ + release/ + App.tsx
- EnvironmentCheckDialog：26 处热点，逐处替换。
- ReleaseChecklistDialog：逐处替换。
- App.tsx：loading 状态 `text-muted-foreground` 保留，`text-sm` 若有→token。

## 5. 测试锚点保留清单（实施时 grep 校验）

实施前后必须存在：
- `[overflow-wrap:anywhere]`（PublishRunCard:225,370）
- `pl-3` / `pl-10`（PublishConfigPanel、RepositoryRow，拖拽手柄显隐）
- `.list-scroll-shell`、`.repo-list-grid`、`.geist-scrollbar`
- `data-list-item-id`/`data-list-row`/`data-list-visual-target`/`data-list-menu-open`/`data-selected`
- `data-testid`：`publish-execute-btn`/`publish-status-panel`/`publish-command-preview`/`pubxml-select-*`/`new-config-btn`/`config-management-btn`/`repo-search-input`
- aria-label `拖动排序`；可见文案 `新建配置`/`配置管理`/`历史记录`/`通用`/`外观`/`关于`/`将执行的命令`

## 6. 不做

- 不改 ui 基础组件（子任务 2 已完成）。
- 不改业务逻辑（store/hooks/lib）。
- 不引入新依赖。
- 不 git commit。

## 7. 验证

- `pnpm typecheck && pnpm test && pnpm doctor` 全绿。
- grep（白名单外无残留）：
  - `rg "text-\[" src/components/{layout,publish,environment,release} src/App.tsx` → 仅白名单（`text-[hsl(var(--text-fine))]`/`text-[hsl(var(--terminal-fg))]`）。
  - `rg "tracking-\[" src/components/{layout,publish,environment,release}` → 仅 `tracking-[0.15em]`（eyebrow 白名单）。
  - `rg "font-bold" src/components` → 空。
  - `rg "text-lg|text-base" src/components/{layout,publish,environment,release} src/App.tsx` → 空（或白名单注明）。
- 测试锚点 grep（§5）全保留。
- `pnpm e2e` 全绿（锚点未破坏）。
