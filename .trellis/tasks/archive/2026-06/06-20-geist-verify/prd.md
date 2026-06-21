# Geist 重构全量验证

## Goal

作为父任务最终门禁：全量验证 token 体系 + UI 组件 + 业务组件重构的成果，确保 typecheck/test/doctor/e2e 全绿、视觉与 design.md/design.dark.md 一致、无死代码与魔数残留。

## 前置

依赖子任务 1/2/3 全部完成。

## Requirements

- 运行全量命令：`pnpm typecheck && pnpm test && pnpm doctor && pnpm e2e`，全部绿。
- grep 校验：
  - `rg "text-\[|tracking-\[" src/components src/App.tsx` 无业务魔数残留（白名单：布局必要任意值）。
  - `rg "font-bold" src/components` 无残留。
  - `rg "hsl\(var\(--" tailwind.config.cjs` 无颜色映射残留。
  - `rg "scrollbar-fade|config-list-row|config-item-selected|--settings-accent|--settings-sidebar-selected|--settings-card-selected|--settings-hairline|--settings-divider|--settings-ink|--settings-icon" src/` 无残留。
  - 测试锚点保留：`rg "list-scroll-shell|repo-list-grid|geist-scrollbar|overflow-wrap:anywhere" src/` 仍在。
- 视觉回归：`pnpm dev`，light/dark 两主题核对主窗、设置 Dialog、各 publish Dialog（Config/QuickCreate/EditRepository/EnvironmentCheck/Release/RerunChecklist/CommandImport/ProjectPublishProfileViewer）、RepositoryList、PublishRunCard 视觉与 design.md 一致。
- P3 核对：在 P3 屏核对 accent 饱和度提升生效。

## Acceptance Criteria

- [ ] `pnpm typecheck && pnpm test && pnpm doctor && pnpm e2e` 全绿。
- [ ] 上述 grep 校验全部通过。
- [ ] light/dark 视觉与 design.md/design.dark.md 一致。
- [ ] P3 屏 accent 宽色域生效。

## Notes

- 轻量任务，可 PRD-only。
- 发现问题回退到对应子任务修复，不在本任务直接改代码（除非是小修补）。
