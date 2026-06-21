# Geist 业务组件与页面重构

## Goal

`src/components/{layout,publish,environment,release}/**` + `src/App.tsx` 业务组件消除手写魔数（`text-[Npx]`/`tracking-[...]`/魔数尺寸），改用子任务 1 的 typography/step token 与子任务 2 的 UI 基础组件，保留全部测试锚点。

## 前置

依赖子任务 1（token）+ 子任务 2（UI 基础组件）。

## Requirements

- 业务组件全部手写 `text-[Npx]`/`text-[11px]`/`text-[13px]`/`text-[14px]`/`text-[18px]` 等替换为 typography token（`text-heading-16`/`text-label-13`/`text-copy-14` 等）。仅 SettingsDialog 就有 13+ 处重复串需统一。
- 手写 `tracking-[-0.224px]`/`tracking-[0.18em]` 等替换为对应 typography token 自带 letterSpacing，或统一 eyebrow 用约定 token。
- 手写魔数尺寸（`h-[18px]`/`pl-[100px]`/`sm:max-w-[560px]` 等）按场景归类：布局尺寸保留（必要任意值），状态/装饰尺寸 token 化。
- `font-bold`（14 处）→ `font-semibold`。
- 半步 spacing（`gap-1.5`/`p-2.5` 等）按场景归并到 Geist 节奏（8/16/32），不强制全改，仅明显不一致处调整。
- 保留全部测试锚点：`.list-scroll-shell`/`.repo-list-grid`/`.geist-scrollbar`/`[overflow-wrap:anywhere]`/`pl-3`/`pl-10`/data-*/aria/文案。
- 保留 `PublishRunCard` 的 `--terminal-bg`/`--terminal-fg` 终端面板（刻意深色，保留）。
- 保留 `ThemePreviewMock` 的 `--theme-preview-*` 隔离变量（刻意并排 light+dark，保留）。

## Acceptance Criteria

- [ ] `rg "text-\[" src/components/{layout,publish,environment,release}` 与 `src/App.tsx` 无业务魔数残留（必要任意值如 `min-h-[80px]` 布局尺寸可保留并在 implement 注明）。
- [ ] `rg "tracking-\[" src/components/{layout,publish,environment,release}` 无手写字距残留。
- [ ] `rg "font-bold" src/components` 无残留。
- [ ] 测试锚点 grep 校验：`.list-scroll-shell`/`.repo-list-grid`/`.geist-scrollbar`/`[overflow-wrap:anywhere]`/`pl-3`/`pl-10`/data 属性全保留。
- [ ] `pnpm typecheck && pnpm test && pnpm e2e` 全绿。

## Notes

- design.md/implement.md 在本任务 `task.py start` 前补齐（复杂任务，体量最大，可能需按 layout/publish/environment-release 分批）。
