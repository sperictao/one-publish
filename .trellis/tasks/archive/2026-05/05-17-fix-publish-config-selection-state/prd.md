# fix publish config selection state

## Goal

修复中栏项目发布配置点击后无法进入选中态的问题，让 `.pubxml` 配置的真实选中状态、视觉选中态和发布命令预览保持一致。

## What I already know

* 已复现：`pnpm e2e tests/e2e/debug-preset-click.spec.ts` 中点击 `FolderProfile` 后，`data-selected` 和 `aria-pressed` 仍为 `false`。
* `PublishConfigPanel` 点击 `.pubxml` 行时会调用 `onSelectProjectProfile(name)`，该回调会写入 `selectedPreset = "profile-${name}"` 且 `isCustomMode = false`。
* 中栏选中态由 `selectedPreset/isCustomMode` 推导：`profile-FolderProfile` 应映射为 `pubxml:FolderProfile`。
* 可疑根因在 `src/stores/appStore.ts`：`currentRepo/currentPublishConfig` 以 getter 暴露，但 store 更新时容易被对象展开固化成陈旧普通字段。
* 当前工作区已有未提交变更和多个调试 e2e 文件；修复必须只改本任务所需文件，不回退既有用户改动。

## Requirements

* 修复 source-of-truth：不要让 `currentPublishConfig` 在 Zustand state 内以可陈旧字段参与读取。
* `useAppState` 应基于当前 `repositories + selectedRepoId` 实时派生 `selectedPreset/isCustomMode/customConfig`。
* `PublishConfigPanel` 不应新增本地“假选中”状态；真实选中仍必须来自 app state。
* 保留或补充可靠测试锚点，例如 `data-selected`，用于 e2e 判断真实选中态。
* 修正与真实产品语义冲突的 e2e 期望：fixture 默认 `profile-FolderProfile` 时，初始应显示 `FolderProfile` 已选中。

## Acceptance Criteria

* [x] 初始加载 `gotoAppWithPublishConfig` 后，`FolderProfile` 显示选中。
* [x] 点击 `ZipProfile` 后，`FolderProfile` 取消选中，`ZipProfile` 显示选中。
* [x] `useAppState` 单测覆盖 `setSelectedPreset` 后 hook 返回值同步变化。
* [x] 发布命令预览随 `.pubxml` profile 切换变化。
* [x] `pnpm test src/hooks/__tests__/useAppState.test.ts` 通过。
* [x] 相关 Playwright e2e 通过，至少覆盖 `04-publish-preset` 和 `07-publish-flow` 里 preset 切换场景。

## Out of Scope

* 不重构 `PublishConfigPanel` floating-card / recent anchor 逻辑。
* 不调整左栏仓库列表行为。
* 不清理所有 debug e2e 文件，除非它们直接阻断验证或属于当前修复提交范围。

## Technical Notes

* 主要检查文件：`src/stores/appStore.ts`、`src/hooks/useAppState.ts`、`src/hooks/__tests__/useAppState.test.ts`、`tests/e2e/specs/04-publish-preset.spec.ts`、`tests/e2e/specs/07-publish-flow.spec.ts`。
* 最小修复方向：把 `currentRepo/currentPublishConfig` 从 Zustand store getter 读取路径移到 hook 派生层，避免 `set({ ...prev })` 固化 getter 值。
* 现有 `PublishConfigPanel.tsx` 中 `data-selected={isPubxmlSelected}` 是合理测试锚点，但不是根因修复。
