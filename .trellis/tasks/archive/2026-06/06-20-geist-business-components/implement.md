# Implement — Geist 业务组件与页面重构

分批执行（layout → publish → environment+release+App），每批跑 `pnpm typecheck`，全完成跑全集。

## 批次 A — layout/（17 组件）

1. **基线** → `pnpm typecheck && pnpm test` 全绿。
2. **SettingsDialog** → 13+ 处 `text-[14px] font-semibold tracking-[-0.224px]`→`text-heading-14 font-semibold`；13+ 处 `text-[12px] leading-[1.4] tracking-[-0.12px]`→`text-label-12 text-muted-foreground`；分类标题 `text-[15px]/[17px] tracking-[-0.3px]`→`text-heading-16 font-semibold`；侧栏项 `text-[13px] tracking-[-0.12px]`→`text-label-13 font-semibold`；accent 调色板 hex 数据保留；保留 aria `通用/外观/关于`。
3. **PublishConfigPanel** → eyebrow `text-xs font-semibold uppercase tracking-wider`→`text-label-12 font-semibold uppercase tracking-[0.15em]`；profile 名 `text-[13px] tracking-tight`→`text-label-13 font-semibold`；其余 `text-sm`/`text-xs` 按表替换；**保留 `pl-3`/`pl-10`/`list-scroll-shell`/`data-list-item-id`/`data-selected`/`pubxml-select-*`/`new-config-btn`/`config-management-btn`**。
4. **RepositoryList** → 品牌 eyebrow `text-[10px] tracking-[0.15em]`→`text-label-12 font-semibold uppercase tracking-[0.15em]`；保留 `repo-list-grid`/`geist-scrollbar`。
5. **RepositoryRow** → 仓库名 `text-[13px] tracking-tight`→`text-label-13 font-semibold`；路径 `text-[11px]`→`text-label-12`；provider 徽章 `text-[10px] font-bold`→`text-label-12 font-semibold`；保留 `pl-3`/`pl-10`/`data-list-item-id`/`aria-pressed`/`aria-label='拖动排序'`。
6. **其余 layout 组件**（MainContentShell/SidebarPanelShell/BranchPanel/CollapsiblePanel/ResizeHandle/EditRepositoryDialog/ShortcutsDialog/ProviderRuntimeBanner/RepositoryRowActionsMenu/RowActionsMenu/ListReorderControls/PublishContentSection/ThemePreviewMock/topbarButtonStyles）→ 逐处替换字号魔数；保留 `pl-[100px]`/布局尺寸/`var(--theme-preview-*)`。
7. **批次 A 验证** → `pnpm typecheck && pnpm test`；grep `text-\[|tracking-\[` 在 layout/ 仅白名单；锚点 grep 保留。

## 批次 B — publish/（18 组件）

8. **PublishRunCard** → 状态 eyebrow `text-[12px] tracking-[0.18em]`→`text-label-12 font-semibold uppercase tracking-[0.15em]`；命令预览/日志 `font-mono text-xs`→`font-mono text-label-12`；**保留 `[overflow-wrap:anywhere]`/`bg-[hsl(var(--terminal-bg))]`/`text-[hsl(var(--terminal-fg))]`/`data-testid='publish-execute-btn'/'publish-status-panel'/'publish-command-preview'`**。
9. **DotnetPublishConfigFormSections** → 29 处字号热点逐处替换。
10. **其余 publish 组件**（ConfigDialog/QuickCreateProfileDialog/CommandImportDialog/CommandImportResultCard/ProjectPublishProfileViewerDialog/RerunChecklistDialog/ExecutionHistoryCard/ArtifactActions/OutputTargetBadge/DiagnosticsSection/ArrayParameter/MapParameter/BooleanParameter/StringParameter/ParameterEditor/ReadonlyParameterFieldsSection）→ 逐处替换；保留 aria name（`目标框架`/`日志详细级别`/`发布前清空目标目录` 等）。
11. **批次 B 验证** → `pnpm typecheck && pnpm test`；grep publish/ 仅白名单。

## 批次 C — environment/ + release/ + App.tsx

12. **EnvironmentCheckDialog** → 26 处热点逐处替换。
13. **ReleaseChecklistDialog** → 逐处替换。
14. **App.tsx** → loading `text-sm`（若有）→token；`text-muted-foreground` 保留。
15. **批次 C 验证** → `pnpm typecheck && pnpm test`。

## 全量验证

16. **grep 校验**（design.md §7）：
    - `rg "text-\[" src/components/{layout,publish,environment,release} src/App.tsx` → 仅 `text-[hsl(var(--text-fine))]`/`text-[hsl(var(--terminal-fg))]`/`text-[hsl(var(--terminal-bg))]`。
    - `rg "tracking-\[" src/components/{layout,publish,environment,release}` → 仅 `tracking-[0.15em]`。
    - `rg "font-bold" src/components` → 空。
    - 锚点 grep（design.md §5）全保留。
17. **全量命令** → `pnpm typecheck && pnpm test && pnpm doctor && pnpm e2e`。
18. **视觉核对** → `pnpm dev`，light/dark 核对主窗/设置/各 Dialog/RepositoryList/PublishRunCard。

## 完成标准

- 业务组件无手写字号/字距魔数（白名单除外）。
- `font-bold` 清零。
- 测试锚点全保留。
- `pnpm typecheck && pnpm test && pnpm doctor && pnpm e2e` 全绿。

## 回滚点

- 每批次独立（A/B/C），任一批 test 红 → `git checkout` 该批次文件。
- e2e 红 → 定位破坏的锚点，回滚对应组件。
