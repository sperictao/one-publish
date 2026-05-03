# 组件规范

> 组件以函数组件为主，使用 TypeScript props 接口、Tailwind className 和现有 UI primitive。不要绕过现有 glass/shadcn/Radix 封装另起一套视觉系统。

## 组件结构

当前代码倾向于：

- 文件顶部集中 import，类型 import 使用 `import type`。
- props 用 `interface XxxProps` 描述；被外部复用的 props/interface 才 `export`。
- 组件主体内先派生翻译、class 常量和 memo/callback，再返回 JSX。
- 复杂组件可在同文件保留只服务本组件的小类型、常量和 helper；跨文件复用后再移动到 `hooks/` 或 `lib/`。

真实参考路径：

- `src/components/layout/RepositoryList.tsx`：props interface、局部 helper、lazy 子组件和列表交互组合。
- `src/components/publish/PublishRunCard.tsx`：导出 props/action 类型，内部派生发布视觉状态。
- `src/components/layout/MainContentShell.tsx`：小型 layout component，显式 props + icon button 可访问性。

## UI primitive 与组合

- 基础按钮、卡片、弹窗、输入等优先使用 `src/components/ui/*`，不要直接复制 Radix 或 shadcn 模板到业务组件里。
- 弹窗优先复用 `AppDialogShell`、`Dialog`、`AppDialogInset`、`AppDialogBadge` 这套结构。
- 列表三点菜单优先复用 `RowActionsMenu` 或对应领域封装，避免每个列表重写菜单交互。
- 图标优先使用 `lucide-react`；只有应用品牌图标等特殊场景才保留自定义 SVG。

真实参考路径：

- `src/components/ui/button.tsx`：`class-variance-authority` + `cn` + Radix `Slot` 的 button variant 模式。
- `src/components/ui/dialog.tsx`：Radix Dialog 封装，内置 overlay、close button 和无障碍文本。
- `src/components/ui/app-dialog-shell.tsx`：应用大弹窗统一外壳和尺寸档位。

## 样式规则

- Tailwind 是主要样式入口；共享视觉令牌来自 `src/index.css` 的 CSS 变量和 glass 工具类。
- className 合并使用 `cn`，不要手写字符串拼接处理条件样式。
- 三栏主界面和大弹窗复用 `glass-card`、`repo-sidebar-shell`、`list-scroll-shell`、`glass-scrollbar` 等现有类。
- 调整左栏/中栏/右栏外壳时，先搜索既有 class 和 mirrored path；不要只改一侧导致三栏视觉漂移。

真实参考路径：

- `src/components/layout/SidebarPanelShell.tsx`：左栏外壳复用 `CollapsiblePanel`、`glass-card`、`repo-sidebar-shell`。
- `src/components/layout/MainContentShell.tsx`：右栏外壳、header view button 和 Tauri drag/no-drag 区域。
- `src/index.css`、`docs/liquid-glass-design-system.md`：glass token 与工具类来源。

## 文案与可访问性

- UI 默认中文，并通过 `useI18n()` 读取功能域翻译；现有组件通常保留中文 fallback。
- 可点击图标按钮必须有 `aria-label` 或 `title`，关闭按钮使用 `sr-only` 文案。
- Tauri 自定义标题栏中，可交互元素必须加 `data-tauri-no-drag`，拖拽容器使用 `data-tauri-drag-region`。
- 长命令、日志、路径要使用 `break-all` / `[overflow-wrap:anywhere]` 等现有模式，避免撑破卡片。

真实参考路径：

- `src/components/layout/MainContentShell.tsx`：header icon button 的 `aria-label`、`title` 和 `data-tauri-no-drag`。
- `src/components/publish/PublishRunCard.tsx`：命令预览和日志区域使用可换行样式。
- `src/components/ui/dialog.tsx`：关闭按钮包含 `sr-only` 的“关闭”文案。

## 常见风险

- 不要在 UI 微调中顺手改变业务逻辑、状态 owner 或持久化行为。
- 不要直接修改 `repo-floating-card`、中栏 floating layer 或拖拽行为，除非任务明确点名；这些区域已有专门 hooks 和回归测试。
- 不要创建卡片套卡片式页面结构；现有页面外壳是 full-height glass shell，卡片用于具体内容块。
