# 前端开发规范

> 本目录记录 OnePublish 前端的真实做法，供后续 `trellis-implement` 与 `trellis-check` agent 使用。内容以当前代码库为准，不描述未落地的理想化规范。

## 项目现状

OnePublish 前端是 React 18 + TypeScript + Vite 7，运行在 Tauri 2 桌面应用中。UI 使用 Tailwind CSS、shadcn/ui 风格封装、Radix primitives、Lucide 图标和 Sonner toast。前端与 Rust 后端通过 Tauri `invoke` 命令和事件协作，类型契约由 `src/generated/tauri-contracts.ts` 生成。

真实参考路径：

- `src/App.tsx`：三栏主界面编排、lazy 加载与核心 hooks 组装。
- `src/lib/store.ts`：前端调用 Tauri store/command 的类型化边界。
- `src/index.css`、`tailwind.config.cjs`：全局设计令牌、glass 视觉系统和 Tailwind 扩展。

## 开发前必读

按改动范围读取对应文件：

| 场景 | 必读规范 |
| --- | --- |
| 新增/移动前端文件 | [目录结构](./directory-structure.md) |
| 新增/修改 React 组件 | [组件规范](./component-guidelines.md) |
| 新增/修改自定义 hook | [Hook 规范](./hook-guidelines.md) |
| 修改应用状态、偏好、历史、发布流 | [状态管理](./state-management.md) |
| 修改类型、Tauri 契约、参数模型 | [类型安全](./type-safety.md) |
| 收尾检查、测试选择、可访问性 | [质量规范](./quality-guidelines.md) |

跨层或复用判断时，也要读取 `.trellis/spec/guides/` 下的 thinking guides。

## 质量检查入口

- 代码改动默认至少跑 `pnpm typecheck`；该命令会先执行 `pnpm check:contracts`，再跑 `tsc --noEmit`。
- 纯文档或 Trellis spec 改动至少跑 `git diff --check`。
- 修改纯函数、hook、组件交互时，优先补/跑对应 Vitest 测试，例如 `src/lib/__tests__/*`、`src/hooks/__tests__/*`、`src/components/**/__tests__/*`。
- 修改真实浏览器几何、拖拽或三栏布局时，用 Playwright e2e 覆盖或复验，例如 `tests/e2e/publish-config-floating-drift.spec.ts`。
