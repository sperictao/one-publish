# 发布、Profile、Provider Module 架构优化

## Goal

把发布执行链、Profile 管理链和 Provider Runtime 从“少数大型 hook + 分散 owner + 跨层硬编码”收敛成边界清晰的模块体系。目标不是一次性重写产品功能，而是在不改变用户可见行为的前提下，降低 `usePublishRunner` / `useProfiles` / Provider registry 周边的职责密度，消除 hook 类型反向依赖和重复持久化入口，并为后续新增 provider、profile 迁移和发布能力扩展建立稳定边界。

## What I Already Know

* 当前任务来自仓库级架构分析，用户已选择更大范围：同时纳入发布工作流、Profile Domain、Provider Runtime 模块化。
* `src/hooks/usePublishRunner.ts` 约 1004 行，聚合了 spec 构建、命令预览、环境检查、输出目录 preflight、macOS 受保护目录恢复、执行、取消、日志快照、toast/system notification、tray 状态、历史记录保存等职责。
* `src/hooks/usePublishRunner.ts` 当前重新导出 `PublishResult`、`ProviderPublishSpec`，导致 `src/lib/publishExecutionRecord.ts`、`src/hooks/usePublishSpecBuilder.ts`、`src/hooks/useRecoverableSpec.ts`、`src/hooks/useTrayRecentPublish.ts`、多个组件和 dialog props 从 hook 文件取类型。
* 生成契约里已经存在 `PublishSpec` / `PublishResult` / `RenderedPublishCommand`，前端规范要求后端 contract 类型从 `src/generated/tauri-contracts.ts` 引入，不手写复制。
* `src/lib/renderPublishCommand.ts`、`src/lib/publishOutputPreflight.ts`、`src/lib/publishFailure.ts` 已经是非 React 的发布边界工具，说明发布模块可先以小步提取方式演进。
* `src/hooks/useProfiles.ts` 约 721 行，是 repo-scoped profile state owner，负责 profile snapshot/cache/revision、保存、编辑、删除、复制、拖拽排序、profile 应用和 quick create/edit 状态。
* `src/components/publish/ConfigDialog.tsx` 约 545 行，仍直接调用 `getProfiles` / `saveProfile` / `deleteProfile` / `exportConfig` / `importConfig` / `applyImportedConfig`，形成第二套 profile 管理入口，依赖 `onProfilesChanged` 回调修补 owner 分裂。
* `src/hooks/useProviderRuntime.ts` 负责前端 provider 列表、schema、active provider 和 provider parameters；`src/hooks/useProviderPresentationState.ts` 负责展示标签和 repository provider options。
* Rust Provider trait / registry 只覆盖 catalog/schema/compile/output/working-dir/runtime program；环境检查仍在 `src-tauri/src/environment/mod.rs` 用 `match provider_id` 硬编码；项目扫描和 provider detection 仍集中在 `src-tauri/src/commands/repository.rs`。
* `src-tauri/src/commands/repository.rs` 约 1155 行，同时覆盖 git branch/connectivity、dotnet project scan、project profile read、provider detection 等职责。
* Rust 侧已经有 provider publish 主入口 `execute_provider_publish`，但仍注册 legacy `execute_publish`；`src-tauri/src/publish.rs` 已标记 deprecated。
* Trellis 当前状态为 planning，本任务目录为 `.trellis/tasks/05-04-publish-workflow-module-architecture`。

## Assumptions

* 本任务应作为架构父任务管理，实施上拆成多个小 PR / 子任务，而不是一个大补丁同时穿透三条链路。
* 本任务默认保持现有发布行为、文案、UI、历史记录格式、profile 存储格式和 Tauri 命令名不变。
* 如果需要移动类型或纯函数，采用兼容导入迁移，避免一次性大规模重写调用方。
* Profile / Provider 的第一阶段目标是收敛 owner 和模块边界，不做 provider 插件系统或 profile 存储格式大迁移。

## Open Questions

* 实施组织方式：创建 3 个子任务分别处理发布、Profile、Provider，还是保持单任务但按阶段提交？
* Rust legacy `execute_publish` 清理是否作为发布子任务的一部分，还是延后到模块边界稳定之后？

## Requirements

* 建立发布 workflow/module 边界，承载发布契约类型、非 React 执行 API 和可复用纯逻辑。
* `src/lib/*` 和展示组件不再从 `src/hooks/usePublishRunner.ts` 导入 `PublishResult` / `ProviderPublishSpec`。
* `usePublishRunner` 保留为 React 编排 hook，但内部职责应拆到更小的纯函数或领域 helper，避免继续扩大。
* 迁移必须保持现有发布入口可用：主界面发布、历史重跑、tray recent publish、命令导入、发布结果展示。
* 建立 Profile Domain 边界，让 profile list/cache/mutation/import/export 的 owner 清晰；`ConfigDialog` 不再维护第二套 profile load/save/delete 逻辑。
* Profile UI 仍复用现有表单和 dialog shell，不做视觉改版。
* 建立 Provider Runtime 边界，区分 provider catalog/schema/runtime state/presentation state，并梳理 Rust provider registry、environment check、repository project scan 的职责分界。
* Rust provider 侧优先消除新的硬编码扩散；是否移动既有命令按子任务边界逐步处理。
* 不改变 `ExecutionRecord.spec` 的存储语义，历史记录仍可恢复和重跑。

## Acceptance Criteria

* [ ] `rg "from \"@/hooks/usePublishRunner\"" src` 只剩实际使用 `usePublishRunner` / `RunPublishOptions` 的必要入口，类型-only 消费者不再依赖 hook 文件。
* [ ] `src/lib/publishExecutionRecord.ts`、`src/hooks/usePublishSpecBuilder.ts`、`src/hooks/useRecoverableSpec.ts`、组件 props 类型改从生成契约或新发布模块导入。
* [ ] `usePublishRunner` 的公开返回行为保持兼容，`App.tsx` 的发布接线不需要理解新增模块内部细节。
* [ ] 发布 runner 相关 Vitest 覆盖仍通过，至少包括 preflight 阻断、受保护目录恢复、失败记录、历史重跑或 tray 入口中的受影响路径。
* [ ] `ConfigDialog` 的 profile 数据变更不再直接绕过 `useProfiles` 的 owner；profile 保存、删除、导入后不依赖“局部刷新 + 外部 onProfilesChanged”双写补偿。
* [ ] Profile quick create/edit、配置管理弹窗、配置导入导出、中栏 profile list 对同一 repo 的列表结果保持一致。
* [ ] Provider 前端 runtime / presentation / provider parameters 的状态边界清晰，`App.tsx` 不继续承接 provider 细节分发。
* [ ] Rust provider catalog/schema/compile/output 与 environment/project-discovery 的职责被记录并按最小可行边界收敛；新增 provider 不需要在多个无关模块重复登记同一事实。
* [ ] 相关 Rust 测试通过，至少覆盖 provider registry、environment scoped check、repository scan/detection 或受影响 command。
* [ ] `pnpm typecheck` 通过。

## Definition of Done

* Tests added/updated where behavior or public module boundary changes.
* `pnpm typecheck` passes.
* Targeted Vitest tests for changed publish/profile/provider workflow paths pass.
* Rust-side checks pass for changed provider/environment/repository modules.
* Pure Trellis/context changes pass `git diff --check`.
* No unrelated UI polish or business behavior change is mixed into this task.
* Each implementation slice keeps changes reviewable and independently verifiable.

## Technical Approach

Recommended direction: parent task with staged module extraction.

* Slice 0: create shared boundaries and type owners. Publish contract aliases should live outside hooks; profile/provider shared types should come from generated contracts or `src/lib/store.ts` adapters.
* Slice 1: Publish Workflow Module. Create a focused publish workflow boundary, likely under `src/features/publish/` or `src/lib/publishWorkflow/`, based on existing directory rules and current `features/` usage. Move publish invoke wrappers and pure helpers out of `usePublishRunner` where practical.
* Slice 2: Profile Domain Module. Keep `useProfiles` as the repo-scoped owner or extract a `useProfileDomain` facade; migrate `ConfigDialog` to consume owner-provided state/actions instead of directly calling store mutations.
* Slice 3: Provider Runtime Module. Split provider runtime state from presentation derivation, then align Rust provider facts so catalog/schema/environment/project-discovery do not drift.
* Slice 4: final cleanup. Remove compatibility re-exports and dead legacy path only after the module boundaries and tests are green.

## Subtasks

Recommended execution order:

* `05-04-publish-workflow-module-boundary` — start here because it removes the hook type reverse dependency that other slices currently touch.
* `05-04-profile-domain-module-boundary` — second, because profile recovery/import/export uses publish spec and config mapping paths.
* `05-04-provider-runtime-module-boundary` — third, because it has the broadest Rust-side blast radius and should build on stable publish/profile boundaries.

## Decision (ADR-lite)

**Context**: The initial architecture analysis identified three high-leverage module deepening opportunities: publish workflow, profile domain, and provider runtime. The user selected the broadest option.

**Decision**: Treat this as a parent architecture task covering all three module boundaries, but implement via staged slices or child tasks.

**Consequences**: This gives the best long-term architecture outcome, but it increases blast radius. The implementation must avoid a single large patch and must keep user-visible behavior stable at each slice.

## Out of Scope

* Full provider plugin system, third-party provider loading, or provider schema format redesign.
* Profile storage format migration unless required for owner consolidation.
* Changing persisted execution history format or breaking old records.
* Removing deprecated Rust legacy publish command before the publish workflow boundary is stable.
* UI visual redesign of the publish panel, profile dialog, provider selector, or environment dialog.

## Technical Notes

* Relevant specs:
  * `.trellis/spec/frontend/index.md`
  * `.trellis/spec/frontend/state-management.md`
  * `.trellis/spec/frontend/type-safety.md`
  * `.trellis/spec/frontend/hook-guidelines.md`
  * `.trellis/spec/frontend/directory-structure.md`
  * `.trellis/spec/frontend/quality-guidelines.md`
  * `.trellis/spec/guides/cross-layer-thinking-guide.md`
  * `.trellis/spec/guides/code-reuse-thinking-guide.md`
* Files inspected:
  * `src/hooks/usePublishRunner.ts`
  * `src/hooks/usePublishSpecBuilder.ts`
  * `src/hooks/usePublishUiState.ts`
  * `src/hooks/useRecoverableSpec.ts`
  * `src/hooks/useRerunFlow.ts`
  * `src/hooks/useTrayRecentPublish.ts`
  * `src/hooks/useProfiles.ts`
  * `src/hooks/useProviderRuntime.ts`
  * `src/hooks/useProviderPresentationState.ts`
  * `src/components/publish/ConfigDialog.tsx`
  * `src/lib/publishExecutionRecord.ts`
  * `src/lib/renderPublishCommand.ts`
  * `src/lib/publishOutputPreflight.ts`
  * `src/lib/publishFailure.ts`
  * `src/App.tsx`
  * `src/generated/tauri-contracts.ts`
  * `src-tauri/src/provider/mod.rs`
  * `src-tauri/src/provider/registry.rs`
  * `src-tauri/src/environment/mod.rs`
  * `src-tauri/src/commands/repository.rs`
  * `src-tauri/src/commands/publish/mod.rs`
  * `src-tauri/src/commands/publish/execution.rs`
  * `src-tauri/src/publish.rs`
  * `src-tauri/src/lib.rs`
