# 质量规范

> 检查强度按改动风险选择。不要因为当前任务简单就跳过基本验证；也不要对纯文档任务强行跑构建。

## 基线命令

- 前端代码改动：至少运行 `pnpm typecheck`。
- 纯函数、hook、组件行为改动：运行相关 Vitest 测试；范围无法判断时运行 `pnpm test`。
- 三栏布局、拖拽、floating card、真实浏览器几何：运行或补充 Playwright e2e。
- 纯文档 / Trellis spec 改动：至少运行 `git diff --check`。

真实参考路径：

- `package.json`：`typecheck`、`test`、`e2e`、`dev:renderer` 等脚本。
- `vitest.config.ts`：JSDOM、`src/test/setup.ts`、排除 e2e。
- `playwright.config.ts`：自动启动 `pnpm dev:renderer`，默认端口来自 `E2E_PORT`。

## 测试分层

- `src/lib/__tests__/`：纯逻辑、映射、路径、失败分类、发布配置等。
- `src/hooks/__tests__/`：hook 状态流、Tauri mock、异步边界。
- `src/components/**/__tests__/`：组件交互、可访问角色、样式护栏。
- `tests/e2e/`：浏览器布局、拖拽和端到端 smoke。

真实参考路径：

- `src/lib/__tests__/projectPublishProfileXml.test.ts`：`.pubxml` 解析纯逻辑。
- `src/hooks/__tests__/usePublishRunner.test.ts`：发布 runner 流程测试。
- `src/components/layout/__tests__/RepositoryList.test.tsx`：列表选择、菜单上下文和排序交互。
- `tests/e2e/publish-config-floating-drift.spec.ts`：中栏 floating drift 回归。

## 代码评审重点

- 状态 owner 是否清晰：持久化状态在 `useAppState`/Rust store，领域状态在对应 hook，组件只保留局部 UI 状态。
- 前后端契约是否走 `src/generated/tauri-contracts.ts` 和 `src/lib/store.ts` normalization。
- UI 是否复用现有 `components/ui`、glass token、i18n、Lucide/Radix 模式。
- 异步结果是否带 repo/provider/scope 防护，是否会把旧请求结果显示到新上下文。
- 长路径、日志、命令、错误信息是否有换行/溢出处理。

真实参考路径：

- `src/hooks/useProjectShellState.ts`：request id + scope key 防旧扫描结果污染。
- `src/hooks/useAppState.ts`：持久化失败回滚到 authoritative state。
- `src/components/publish/PublishRunCard.tsx`：命令和日志换行护栏。

## 可访问性与桌面环境

- 交互控件要有可识别名称，测试中优先通过 role/name 查找。
- Radix primitive 是 Dialog/Select/Switch/Dropdown 的默认基础，不要改成无语义 div。
- Tauri 标题栏区域必须区分 drag/no-drag；否则按钮可能无法点击或窗口无法拖拽。
- macOS/Windows/Linux 路径和权限差异要通过后端 preflight 或路径工具处理，前端不做脆弱字符串猜测。

真实参考路径：

- `src/components/ui/dialog.tsx`、`src/components/ui/dropdown-menu.tsx`、`src/components/ui/switch.tsx`：Radix primitive 封装。
- `src/components/layout/MainContentShell.tsx`：Tauri drag/no-drag 与 header buttons。
- `src/lib/publishOutputPreflight.ts`、`src/lib/paths.ts`：发布目录和路径处理。

## 禁止和谨慎项

- 不要修改 `src/generated/tauri-contracts.ts`，除非通过生成流程更新。
- 不要在未搜索 mirrored update path 的情况下改配置、常量、模板或视觉令牌。
- 不要把真实业务错误吞掉只留 toast；日志、执行历史和诊断导出是产品能力。
- 不要把 `eslint-disable`、`any`、类型断言当作常规修复方式。
- 不要混合无关重构、UI polish 和业务行为变更。
