# 发布工作流 Module 边界收敛

## Goal

把前端发布执行链从 `usePublishRunner` 的大型 hook 中拆出稳定模块边界。重点是类型来源、非 React invoke API、执行记录/失败处理/命令渲染等纯逻辑边界，不改变用户可见发布行为。

## Requirements

* 发布契约类型从生成契约或新发布模块导入，不再由 `usePublishRunner.ts` 重新导出给 `lib`、组件和其他 hooks 使用。
* 建立非 React 发布 API 边界，集中 `execute_provider_publish`、`render_provider_publish`、`cancel_provider_publish`、preflight 等调用。
* `usePublishRunner` 保留 UI 编排职责，但不继续拥有所有基础类型、invoke 包装和可复用纯逻辑。
* 保持主界面发布、历史重跑、tray recent publish、命令导入、发布结果展示行为兼容。
* 不改变 `ExecutionRecord.spec` 存储语义，不破坏旧历史记录恢复和重跑。

## Acceptance Criteria

* [x] `rg "from \"@/hooks/usePublishRunner\"" src` 只剩实际使用 `usePublishRunner` / 必要运行选项的入口。
* [x] `src/lib/publishExecutionRecord.ts`、`src/hooks/usePublishSpecBuilder.ts`、`src/hooks/useRecoverableSpec.ts`、相关组件 props 不再从 hook 文件取发布契约类型。
* [x] 发布执行、取消、preflight、受保护目录恢复、失败记录、历史重跑或 tray 入口的受影响测试通过。
* [x] `pnpm typecheck` 通过。

## Implementation Notes

* Added `src/lib/publishRuntime.ts` as the non-React Tauri boundary for publish execution, cancel, render, preflight, and command import.
* Kept `renderPublishCommand.ts` and `publishOutputPreflight.ts` as semantic helpers that delegate to `publishRuntime`.
* Moved `RunPublishOptions` to `src/hooks/usePublishRunnerTypes.ts` because it describes UI/tray orchestration, not runtime invoke contracts.
* Verified with targeted Vitest, typecheck, import search, and `git diff --check`.

## Technical Approach

* 先创建发布契约/运行时 API 边界，优先复用 `src/generated/tauri-contracts.ts`。
* 小步迁移类型-only import，再迁移 invoke wrapper 和纯 helper。
* 保持 `usePublishRunner` 对 `App.tsx` 的返回接口稳定，避免 UI 接线扩散。

## Out of Scope

* 发布 UI 视觉改动。
* 执行历史格式迁移。
* Provider Runtime 或 Profile Domain 深化。
* 删除 Rust legacy `execute_publish`，除非父任务后续明确将其纳入最终清理。

## Technical Notes

* Parent task: `.trellis/tasks/05-04-publish-workflow-module-architecture`
* Key files:
  * `src/hooks/usePublishRunner.ts`
  * `src/hooks/usePublishSpecBuilder.ts`
  * `src/hooks/usePublishUiState.ts`
  * `src/hooks/useRecoverableSpec.ts`
  * `src/hooks/useRerunFlow.ts`
  * `src/hooks/useTrayRecentPublish.ts`
  * `src/lib/publishExecutionRecord.ts`
  * `src/lib/renderPublishCommand.ts`
  * `src/lib/publishOutputPreflight.ts`
  * `src/lib/publishFailure.ts`
  * `src/generated/tauri-contracts.ts`
