# Hook 规范

> 自定义 hook 是本项目拆分复杂 UI 流程的主要方式。Hook 应该封装状态和副作用边界，组件负责展示与事件接线。

## 命名与接口

- Hook 文件和导出函数使用 `useXxx`。
- 参数较多时使用单一 params object，并定义 `UseXxxParams` interface。
- 返回值使用对象，保持调用点可读；避免返回位置敏感的数组。
- hook 内部需要的翻译通常接收 `TranslationMap` 或从 `useI18n()` 获取。

真实参考路径：

- `src/hooks/usePublishRunner.ts`：`UsePublishRunnerParams` 聚合发布执行所需输入和回调。
- `src/hooks/useProjectShellState.ts`：params object + request id/ref 防止旧扫描结果污染当前仓库。
- `src/hooks/useRepositoryActions.ts`：返回一组 handler，由组件负责传给 UI。

## 副作用与异步

- Tauri/文件系统/进程相关副作用通过 `src/lib/*` 包装后在 hook 中调用，不要把 `invoke` 散落到组件。
- 长流程要显式处理 stale result：当前代码常用 request id ref、selected scope ref、snapshot signature 和 revision。
- `useEffect` 中发起 async 时用 `void` 调用或内部 async 函数，并在 cleanup 中清理 timer、订阅或 mounted 标记。
- 高频持久化使用 debounce 或队列；失败后回读后端 authoritative state 并 toast。

真实参考路径：

- `src/hooks/useAppState.ts`：UI/发布/偏好状态防抖保存，持久化失败后重新加载 authoritative state。
- `src/hooks/useProfiles.ts`：按 repo 缓存 profile snapshot，并用 request id 避免过期请求覆盖当前 UI。
- `src/hooks/usePublishHistoryState.ts`：执行历史加载、保存和 limit 裁剪集中在 hook 内。

## 数据获取模式

本项目没有 React Query/SWR。当前模式是：

- `src/lib/store.ts`、`src/lib/environment.ts` 等文件提供 Tauri command 的 typed wrapper。
- hook 调用这些 wrapper，管理 loading/error/result。
- UI 组件接收 hook 派生好的状态和 action，不直接理解后端命令细节。

真实参考路径：

- `src/lib/store.ts`：`getAppState()`、`getProfiles()`、`openOutputDirectory()` 等命令包装与数据标准化。
- `src/lib/environment.ts`：环境检查命令和 provider-scope snapshot 工具。
- `src/hooks/useEnvironmentStatus.ts`：从 scoped snapshot 派生 `unknown | ready | warning | blocked`。

## 性能与拆分

- 面向首屏较重的弹窗/面板可用 `React.lazy` + `Suspense` 延迟加载。
- heavy runtime 或很少触发的逻辑可动态 import，保持主包和常规 render 路径轻。
- 派生数组、筛选、命令预览、状态签名等使用 `useMemo`；事件处理传给子组件时使用 `useCallback`。

真实参考路径：

- `src/App.tsx`：`AppDialogsHost`、`RepositoryList`、`PublishConfigPanel` 等通过 lazy 加载。
- `src/hooks/useRepositoryActions.ts`：运行时 repository action 通过 `loadRepositoryActionsRuntime()` 动态导入。
- `src/hooks/usePublishRunner.ts`：失败反馈、取消反馈、invoke error 模块按需动态导入。

## 常见风险

- 不要让多个 hook 同时拥有同一份可持久化状态的写入权；先确认 `useAppState`、`useProfiles`、`usePublishHistoryState` 等 owner。
- 不要在 hook dependency 中省略会改变语义的值；现存少量 eslint disable 是例外，不是默认做法。
- 不要把 UI className 或 JSX 塞进通用 hook；局部 layout hook 例外，但应留在组件目录内。
