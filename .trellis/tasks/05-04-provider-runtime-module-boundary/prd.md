# Provider Runtime Module 边界收敛

## Goal

把 Provider Runtime 的前端状态和 Rust provider 事实源边界收敛清楚，减少 catalog/schema/environment/project-discovery 在多个模块里重复登记或硬编码同一 provider 事实。

## Requirements

* 前端区分 provider runtime state、presentation derivation、provider parameters，避免 `App.tsx` 承接过多 provider 细节分发。
* Rust provider registry 继续作为 catalog/schema/compile/output 等 provider 事实的主要入口。
* environment check 与 repository project discovery 的职责分界要清晰记录并按最小可行方式收敛，避免新增 provider 时多处漏改。
* 保持现有 provider 列表、schema 加载、provider selector、环境检查、项目绑定行为兼容。
* 不实现第三方 provider 插件系统或 provider schema 格式重设计。

## Acceptance Criteria

* [x] 前端 provider runtime/presentation/parameters 边界清晰，新增 provider UI 不需要在 `App.tsx` 增加无关分发逻辑。
* [x] Rust provider catalog/schema/compile/output 与 environment/project-discovery 职责边界被代码结构或文档化 helper 体现。
* [x] 新增 provider 所需登记点减少或集中，至少不再扩散新的硬编码入口。
* [x] provider registry、environment scoped check、repository scan/detection 或受影响 command 的 Rust 测试通过。
* [x] `pnpm typecheck` 通过；若 Rust 侧改动，相关 `cargo test` / `cargo check` 通过。

## Technical Approach

* 先拆前端 provider runtime facade，保持 UI API 稳定。
* Rust 侧优先识别可收敛的 provider metadata 和 capability 查询，不急于移动大型 repository command。
* 对 environment/project-discovery 采用小步 helper/trait/capability 扩展，避免一次性重写命令模块。

## Out of Scope

* Provider plugin marketplace 或动态加载。
* provider schema JSON 格式 redesign。
* 发布执行行为和 profile 管理行为改动。

## Technical Notes

* Parent task: `.trellis/tasks/05-04-publish-workflow-module-architecture`
* Implementation:
  * `src/hooks/useProviderRuntime.ts` now owns provider catalog, active provider id, schema resource state and schema cache only.
  * `src/hooks/useProviderParametersState.ts` owns provider-scoped parameter drafts.
  * `src/hooks/useProviderPresentationState.ts` owns provider label, project binding capability, repository options and runtime banner derivation.
  * Rust `ProviderRepositoryDiscovery` metadata lives in `src-tauri/src/provider/registry.rs`; repository commands consume it for provider detection and project-file scanning.
  * `src-tauri/src/environment/mod.rs` keeps runtime probe dispatch separate from provider catalog/discovery facts.
* Validation:
  * `git diff --check`
  * `pnpm exec vitest run "src/hooks/__tests__/useProviderRuntime.test.ts" "src/hooks/__tests__/useProviderParametersState.test.ts" "src/hooks/__tests__/useProviderPresentationState.test.ts" "src/hooks/__tests__/useDialogsCompositionState.test.ts" "src/__tests__/App.test.tsx"`
  * `pnpm typecheck`
  * `cargo test --manifest-path "src-tauri/Cargo.toml"`
  * `cargo check --manifest-path "src-tauri/Cargo.toml"`
* Residual risk:
  * `cargo test` still reports existing deprecated warnings from `src/publish.rs` tests that call `build_dotnet_publish_plan`; this task did not expand into publish legacy cleanup.
* Key files:
  * `src/hooks/useProviderRuntime.ts`
  * `src/hooks/useProviderPresentationState.ts`
  * `src/hooks/useProviderParametersState.ts`
  * `src/lib/providers.ts`
  * `src-tauri/src/provider/mod.rs`
  * `src-tauri/src/provider/registry.rs`
  * `src-tauri/src/environment/mod.rs`
  * `src-tauri/src/commands/repository.rs`
