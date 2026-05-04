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
- 发布命令运行时通过 `src/lib/publishRuntime.ts` 集中调用 Tauri commands；`usePublishRunner` 只保留发布 UI 编排、反馈、日志和历史记录接线，不重新导出 `PublishSpec` / `PublishResult` 等契约类型。
- 发布预览和输出目录预检继续走语义 helper（如 `src/lib/renderPublishCommand.ts`、`src/lib/publishOutputPreflight.ts`），这些 helper 再委托到 `publishRuntime`，避免 hook 直接绕过领域语义层。

真实参考路径：

- `src/lib/store.ts`：从 `src/generated/tauri-contracts.ts` 引入 Tauri 类型，再 normalize 成前端类型。
- `src/lib/publishRuntime.ts`：发布执行、取消、命令渲染、输出目录预检、命令导入的非 React Tauri 边界。
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

## Profile Domain Owner

- `useProfiles` 是 repo-scoped profile list、snapshot revision、刷新、保存、删除、导出和应用导入的唯一 owner。
- 组合层向配置管理弹窗传递 `ProfileManagementActions` facade；只允许在 UI 边界展开为 `profiles`、`isRefreshing`、`refreshProfiles`、`saveProfile`、`deleteProfile`、`exportProfiles`、`applyImportedProfiles` 回调。
- `ConfigDialog` / `ConfigManagementContent` 只能保留文件选择、导入解析和确认对话框这类局部 UI 状态；不得直接调用 `getProfiles`、`saveProfile`、`deleteProfile`、`exportConfig`、`applyImportedConfig` 来维护第二套列表。
- profile mutation 必须先捕获目标 `repoId`，mutation 成功后刷新同一个 repo 的 owner snapshot；如果用户已切换仓库，只更新该 repo cache，不把旧 repo 结果写入当前可见列表。

错误示例：

```tsx
// Bad: dialog 绕过 owner 直接改 store，再用刷新回调补偿中栏列表。
await saveProfile({ repoId, name, providerId, parameters });
await onProfilesChanged?.();
```

正确示例：

```tsx
// Good: dialog 调用 owner action，snapshot 刷新和 repo scope 由 useProfiles 负责。
await onSaveProfile({ name, providerId, parameters });
```

测试要求：

- `src/hooks/__tests__/useProfiles.test.ts` 覆盖 facade mutation 后刷新同一个 owner snapshot，并保持 repo 切换时的 stale result 防护。
- `src/components/publish/__tests__/ConfigDialog.test.tsx` 覆盖弹窗通过 owner callbacks 保存、删除、导出和应用导入，不 mock store mutation API。

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
