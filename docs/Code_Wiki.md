# OnePublish Code Wiki

**OnePublish** 是一个跨平台的项目发布工具，主要提供图形化界面来执行 `.NET publish` 及其他编程语言项目的发布命令。

---

## 1. 项目整体架构

本项目基于 **Tauri** 框架构建，采用典型的前后端分离桌面应用架构：

*   **前端 (Frontend)**: 基于 **React 18 + TypeScript + Vite**，主要负责构建现代化的、跨平台一致的 UI（类似 macOS 风格），响应用户操作（如添加仓库、修改发布参数、触发发布等），并实时展示终端输出日志和历史记录。样式使用 **Tailwind CSS** 与 **shadcn/ui**。
*   **后端 (Backend)**: 基于 **Rust**，处理所有的操作系统底层交互，包括：文件系统扫描、环境依赖检测（如 `dotnet`、`cargo` 工具链是否就绪）、执行发布子进程 (`tokio::process`)、流式日志捕获、系统托盘及配置持久化管理。
*   **IPC 通信 (Inter-Process Communication)**: 前后端通过 Tauri 的 `invoke` 系统进行命令调用，通过 Tauri 的 Event 系统进行日志流和通知的实时推送。

---

## 2. 主要模块职责

### 2.1 前端模块 (`src/`)

*   **`src/App.tsx`**: 应用的根组件，负责整体界面的**三栏式布局**（仓库列表、配置面板、主操作区），协调和串联各个 Hooks 的状态。
*   **`src/components/`**: UI 视图层。
    *   `layout/`: 布局组件，如 `RepositoryList` (仓库列表面板)、`PublishConfigPanel` (配置属性面板) 和 `MainContentShell` (主内容区)。
    *   `publish/`: 发布操作相关组件，如执行命令预览、运行状态卡片 (`PublishRunCard`) 和配置表单。
    *   `ui/`: 基于 shadcn/ui 封装的基础原子组件。
*   **`src/hooks/`**: 业务逻辑层。包含大量自定义 Hooks 来管理状态和交互（例如 `useAppState`, `usePublishRunner`, `useProfiles`, `useProviderRuntime` 等）。
*   **`src/lib/`**: 工具层。包含与 Tauri 后端交互的封装 (`store.ts`)、参数解析器 (`dotnetPublishConfig.ts`) 和环境校验逻辑。
*   **`src/generated/`**: 自动生成的类型契约 (`tauri-contracts.ts`)，保证前后端数据结构的一致性。

### 2.2 后端模块 (`src-tauri/src/`)

*   **`main.rs` & `lib.rs`**: Tauri 程序的入口，初始化插件（Log、Updater、Dialog、GlobalShortcut 等）、构建系统托盘并注册各个 `invoke` 命令。
*   **`commands/`**: 核心命令处理层，供前端调用。
    *   `publish/`: 处理发布核心逻辑，包括命令组装、进程拉起、日志流式读取 (`logs.rs`)、执行上下文会话维护 (`session.rs`) 及发布前预检 (`preflight.rs`)。
    *   `repository.rs`: 项目仓库和分支扫描。
*   **`environment/` & `provider/`**: Provider 架构模块。定义了抽象的工具链提供者（Provider），并分别实现了对 `cargo`, `dotnet`, `go`, `java` 的环境检测（版本检查、安装状态）及命令行参数 Schema 解析。
*   **`store/`**: 数据持久化与状态管理。负责维护 `AppState`，管理用户添加的仓库、Profile 配置以及执行历史，并将这些数据序列化保存到本地文件。
*   **`compiler.rs` & `parameter.rs`**: 将前端传递过来的结构化配置 (JSON Schema) 编译渲染为实际的 CLI 参数数组。

---

## 3. 关键类与函数说明

### 前端关键函数 / Hooks
*   **`useAppState()`**: 管理全局应用配置、界面偏好（侧边栏宽度、语言、主题等），与 Rust 后端的 `store` 进行同步。
*   **`usePublishRunner()`**: 发布管线核心 Hook。负责收集发布配置、触发 `execute_provider_publish` IPC 调用、控制发布流程中的状态（如 `isPublishing`）、并接收日志流。
*   **`getAppState() / updatePreferences() / scanProject() ` (`src/lib/store.ts`)**: 封装了向 Tauri 发送 IPC 请求的 Promise API。

### 后端关键函数 / Structs
*   **`PublishSpec`** (Struct): 统一的发布描述规范，包含 Provider ID（如 `dotnet`）、项目路径和参数表。
*   **`execute_publish_spec()`** (`commands/publish/execution.rs`): 核心异步发布函数。执行预检 (`ensure_publish_output_preflight`)，拉起子进程 (`tokio::process::Command`)，挂载 `stdout` 和 `stderr` 的流读取任务并发出 Tauri 事件，最后返回 `PublishResult`。
*   **`check_environment()`** (`environment/mod.rs`): 扫描当前操作系统的环境变量和工具链（通过各个 Provider 的 `check_*` 方法），并返回可能的缺失问题及修复建议。
*   **`update_state() / get_state()`** (`store/runtime.rs`): 在内存中持有一份全局的线程安全 `AppState` 状态，控制读写锁，并负责持久化写入磁盘。

---

## 4. 依赖关系

### 4.1 前端核心依赖 (`package.json`)
*   **构建与框架**: `react` (^18.2), `vite`, `typescript`
*   **桌面集成**: `@tauri-apps/api` (^2.8), `@tauri-apps/plugin-*` (用于文件系统、进程、弹窗、Shell交互)
*   **UI 与样式**: `tailwindcss` (^3.4), `@radix-ui/react-*` (无头组件库), `lucide-react` (图标), `sonner` (Toast 提示)
*   **测试**: `vitest`, `@playwright/test`

### 4.2 后端核心依赖 (`Cargo.toml`)
*   **Tauri 与生态**: `tauri` (^2.8.2), `tauri-plugin-*` (日志、更新器、快捷键等)
*   **异步与并发**: `tokio` (使用其 `macros`, `rt-multi-thread`, `process` 等特性管理异步命令执行)
*   **序列化与数据**: `serde`, `serde_json`, `chrono` (时间处理)
*   **错误处理**: `thiserror`, `anyhow`
*   **类型共享**: `ts-rs` (用于将 Rust 结构体自动导出为 TypeScript 接口)

---

## 5. 项目运行方式

### 5.1 前置环境要求
*   **Node.js** 18 或更高版本
*   **pnpm** (包管理器)
*   **Rust** 1.77 或更高版本 (包含 Cargo)
*   对应的构建目标 SDK (例如：发布 .NET 项目需安装 **.NET SDK**)

### 5.2 初始化依赖
在项目根目录下执行：
```bash
pnpm install
```

### 5.3 开发模式运行
使用以下命令将同时启动 Vite 前端开发服务器以及 Tauri 桌面客户端：
```bash
pnpm dev
```

### 5.4 构建生产版本
构建用于分发的原生应用安装包（位于 `src-tauri/target/release/bundle/`）：
```bash
pnpm build
```

### 5.5 其他常用命令
*   **更新后端与前端类型契约**: `pnpm generate:contracts` (调用 Rust 的示例程序生成 TypeScript 类型定义)
*   **运行前端测试**: `pnpm test` (基于 Vitest)
*   **运行端到端 (E2E) 测试**: `pnpm e2e` (基于 Playwright)
