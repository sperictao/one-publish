# 状态管理

> 当前项目没有 Redux/Zustand/React Query。状态按“后端持久化真相源 + 前端 hook owner + 组件局部状态”拆分。

## 状态分类

- 持久化应用状态：仓库列表、选中仓库、面板宽度、发布配置、语言、主题、环境 provider 偏好等，由 `useAppState` 管理，并通过 `src/lib/store.ts` 调用 Rust store。
- 发布执行状态：发布中、取消中、结果、日志、当前执行记录等，由 `usePublishRunner`、`usePublishUiState`、`usePublishLogStream` 管理。
- 仓库/项目派生状态：当前仓库、项目扫描结果、profile 列表、provider schema 等由领域 hook 按 scope 缓存和派生。
- 组件局部 UI 状态：搜索框、展开/折叠、菜单上下文、临时表单草稿等留在组件或领域 hook 内。

真实参考路径：

- `src/hooks/useAppState.ts`：持久化 app state 的主要 owner。
- `src/hooks/usePublishRunner.ts`：发布执行流程与 preflight、环境检查、日志、记录保存的编排。
- `src/components/layout/RepositoryList.tsx`：搜索、过滤展开、排序开关等局部 UI state。

## 持久化与后端边界

- 前端通过 `src/lib/store.ts` 调用 Tauri commands；Rust store 是持久化 authority。
- 乐观更新允许改善 UI 响应，但失败必须回读 authoritative state 并提示用户。
- 新增持久化字段时，要同时检查生成契约、默认值、迁移/兼容、前端 normalization 和测试。
- 不要绕过 `lib/store.ts` 在组件里直接 `invoke("save...")`。

真实参考路径：

- `src/lib/store.ts`：从 `src/generated/tauri-contracts.ts` 引入 Tauri 类型，再 normalize 成前端类型。
- `src/hooks/useAppState.ts`：`restoreAuthoritativeState()` 与 `handlePersistenceFailure()`。
- `src/hooks/usePublishHistoryState.ts`：执行历史通过 `getExecutionHistory()` / `addExecutionRecord()` 同步。

## 派生状态与 scope

- 派生状态优先用 `useMemo` 或明确 helper 函数，不把可计算结果重复持久化。
- 跨仓库/跨 provider 的结果必须带 scope key 或 provider id；避免旧仓库、旧 provider 的结果污染当前 UI。
- 缓存 snapshot 需要 signature/revision 时，保持 key 构造和 invalidation 逻辑在同一 hook 内。

真实参考路径：

- `src/hooks/useProjectShellState.ts`：按 repo/project scope 缓存 `ProjectInfoSnapshot`，并用 request id 防 stale update。
- `src/hooks/useProfiles.ts`：按 repo 缓存 profile snapshot 与 revision。
- `src/lib/environment.ts`、`src/hooks/useEnvironmentStatus.ts`：环境检查结果按 provider ids 过滤和判断状态。

## UI 状态与布局

- 三栏折叠、宽度和主视图切换由 `App.tsx` 组合多个 hooks 后传给布局组件。
- 列表 hover/floating/drag 状态集中在 layout 局部 hooks，左栏和中栏已有分离实现。
- 影响布局几何的状态改动需要考虑 Playwright e2e，而不只依赖 JSDOM。

真实参考路径：

- `src/hooks/useLayoutShellState.ts`：三栏 shell 状态。
- `src/components/layout/useFloatingRepoCard.ts` 与 `src/components/layout/useFloatingConfigCard.ts`：左栏/中栏 floating 行为分离。
- `tests/e2e/publish-config-floating-drift.spec.ts`：浏览器几何回归验证。

## 常见风险

- 不要把同一个状态同时存到 localStorage、React state 和 Rust store，除非已有同步规则；语言目前同时有偏好和 `useI18n` localStorage，需要按现有同步方式改。
- 不要在发布执行中只更新 UI，不保存执行记录；`savePublishRecord` 是历史能力的一部分。
- 不要在 repo 切换、provider 切换时复用未带 scope 的异步结果。
