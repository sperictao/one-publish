<div align="center">

<img src="src-tauri/icons/128x128@2x.png" alt="OnePublish 图标" width="128" height="128" />

# OnePublish

**多语言项目发布，优雅简化。**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Tauri 2](https://img.shields.io/badge/Tauri-2.x-FFC131?logo=tauri&logoColor=white)](https://tauri.app)
[![React 18](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Rust](https://img.shields.io/badge/Rust-1.77+-DEA584?logo=rust&logoColor=white)](https://www.rust-lang.org)

[English](README.md) · [简体中文](README.zh-CN.md)

</div>

---

## OnePublish 是什么？

OnePublish 是一个**跨平台桌面应用**，为软件项目发布提供美观高效的图形化界面。无需记忆复杂的命令行参数——选择仓库、通过智能表单配置参数、一键发布。

**一个工具，多种语言。** .NET · Rust (cargo) · Go · Java (Gradle) —— 统一界面，统一体验。

## ✨ 核心亮点

- 🎯 **多语言发布** — 支持 .NET（`dotnet publish`）、Rust（`cargo build --release`）、Go（`go build`）、Java/Gradle，更多语言持续接入
- 🧠 **Schema 驱动参数** — 100% 参数表达能力：所有 CLI 标志、环境变量、参数均可表示与校验，非硬编码
- 📋 **命令导入** — 粘贴任意 CLI 命令，OnePublish 自动逆向解析为结构化参数
- 📊 **执行历史** — 本地保留最近 20+ 次运行记录，一键重跑
- 🔍 **环境诊断** — 自动检测缺失的工具链（SDK、运行时），提供引导式修复
- 🎨 **Apple Liquid Glass 设计** — macOS 风格界面：毛玻璃材质、弹簧动画、镜面高光
- 🌐 **国际化** — 完整支持简体中文和 English
- 🌓 **深色/浅色主题** — 跟随系统偏好自动切换
- 🔄 **自动更新** — Tauri 内置更新管线，集成 GitHub Releases
- ⌨️ **键盘优先** — 全局快捷键覆盖高频操作；无需鼠标即可发布
- 📦 **一键 GitHub Release** — `pnpm release -v 1.0.0` 同步版本、生成发布说明、提交、打标签、推送并等待 CI 完成

---

## 📸 界面预览

<!-- TODO: 添加实际截图 -->
> *截图即将补充。在此期间，可查阅[设计理念](docs/design-philosophy.md)与 [Liquid Glass 设计系统](docs/liquid-glass-design-system.md)。*

---

## 🚀 快速开始

### 环境要求

| 依赖 | 版本 | 用途 |
|------|------|------|
| **Node.js** | ≥ 18 | 前端运行时 |
| **pnpm** | 最新版 | 包管理器 |
| **Rust** | ≥ 1.77 | Tauri 后端编译 |
| **目标 SDK** | 按需 | 至少安装一种：.NET SDK / Rust / Go / Java (Gradle) |

### macOS — 安装开发依赖

```bash
# Xcode Command Line Tools（macOS 上 Tauri 必需）
xcode-select --install

# Node.js 与 pnpm
brew install node pnpm

# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### Linux — 安装开发依赖

```bash
# Ubuntu/Debian
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev

# Fedora
sudo dnf install webkit2gtk4.1-devel openssl-devel libappindicator-gtk3-devel \
  librsvg2-devel
```

### Windows — 安装开发依赖

```bash
# 使用 Chocolatey
choco install nodejs pnpm rust
# 或通过官方安装包：nodejs.org、rustup.rs
```

### 构建与运行

```bash
# 克隆仓库
git clone https://github.com/sperictao/one-publish.git
cd one-publish

# 安装依赖
pnpm install

# 开发模式（热更新）
pnpm dev

# 生产构建
pnpm build
# 产物目录：src-tauri/target/release/bundle/
```

---

## 🏗️ 项目架构

```
one-publish/
├── src/                          # React 前端（TypeScript）
│   ├── components/
│   │   ├── ui/                   # shadcn/ui 基础组件（Button、Dialog、Select...）
│   │   ├── layout/               # 布局组件：面板、拖拽手柄、侧边栏
│   │   ├── publish/              # 发布配置：参数编辑器、命令导入
│   │   ├── release/              # 发布检查清单向导
│   │   └── environment/          # 环境诊断界面
│   ├── features/                 # 领域逻辑：发布、仓库、provider、环境
│   ├── hooks/                    # React hooks：useI18n、useAppState、useShortcuts...
│   ├── stores/                   # Zustand 状态切片
│   ├── lib/                      # 工具函数：store API、路径、预检、产物
│   ├── i18n/                     # 翻译文件：zh.json、en.json
│   └── index.css                 # Liquid Glass 设计令牌 + 工具类
│
├── src-tauri/                    # Rust 后端（Tauri）
│   ├── src/
│   │   ├── main.rs               # 入口
│   │   ├── lib.rs                # 插件注册 + 命令处理器
│   │   ├── provider/             # 语言 provider trait 及实现
│   │   │   └── providers/        # dotnet.rs、cargo.rs、go.rs、java_gradle.rs
│   │   ├── commands/             # Tauri IPC 命令（发布、仓库、更新）
│   │   ├── environment/          # 各语言环境检查
│   │   ├── compiler.rs           # Spec → ExecutionPlan 编译器
│   │   ├── spec.rs               # PublishSpec（语言无关数据模型）
│   │   ├── plan.rs               # ExecutionPlan（有序步骤）
│   │   ├── parameter.rs          # ParameterSchema + 校验
│   │   ├── store/                # 持久化（JSON 文件存储）
│   │   ├── config_export.rs      # 配置导入/导出
│   │   ├── shortcuts.rs          # 全局快捷键注册
│   │   └── tray.rs               # 系统托盘
│   ├── Cargo.toml                # Rust 依赖
│   └── tauri.conf.json           # Tauri 窗口、打包、更新配置
│
├── tests/e2e/                    # Playwright e2e 测试
├── scripts/                      # 构建/发布自动化脚本
├── docs/                         # 文档
│   ├── design-philosophy.md      # 产品与工程理念
│   ├── liquid-glass-design-system.md
│   ├── roadmap/MASTER_PLAN.md    # 开发路线图（11 阶段）
│   ├── updater/SETUP.md          # 更新配置指南
│   └── release/GITHUB_RELEASE.md # 发布管线文档
├── DESIGN.md                     # Apple 设计分析（参考）
├── package.json
├── vite.config.ts
├── tailwind.config.cjs
└── tsconfig.json
```

---

## 🧩 核心工作流

> **PublishSpec → ExecutionPlan → Execute**

1. **选择仓库** — 自动扫描本地项目文件（`.sln`、`Cargo.toml`、`go.mod`、`build.gradle` 等）
2. **配置发布参数** — 使用预设、Schema 驱动表单或粘贴原始 CLI 命令
3. **预检** — 验证输出路径、环境就绪状态、分支状况
4. **执行** — 实时流式输出 `stdout`/`stderr`，支持随时取消
5. **回顾** — 历史时间线记录每次运行；一键重跑、导出诊断、生成 CI 交接片段

---

## 🛠️ 技术栈

| 层级 | 技术 |
|------|------|
| **前端框架** | React 18 + TypeScript |
| **构建工具** | Vite 7 |
| **样式** | Tailwind CSS 3 + shadcn/ui（Radix UI） |
| **设计系统** | Apple Liquid Glass（毛玻璃模糊、弹簧物理、镜面高光） |
| **状态管理** | Zustand 5 |
| **图标** | Lucide React |
| **通知** | Sonner |
| **桌面框架** | Tauri 2.x（Rust） |
| **持久化** | JSON 文件存储（`~/.one-publish/config.json`） |
| **类型桥接** | `ts-rs`（Rust ↔ TypeScript 合约自动生成） |
| **单元测试** | Vitest（前端）+ Rust `#[cfg(test)]`（后端） |
| **E2E 测试** | Playwright |
| **包管理器** | pnpm |

---

## 📜 可用脚本

```bash
# 开发
pnpm dev                 # 完整 Tauri 开发模式（前端 + 后端）
pnpm dev:renderer        # 仅 Vite 开发服务器（前端）

# 构建
pnpm build               # 生产 Tauri 打包
pnpm build:renderer      # 仅前端构建

# 质量
pnpm typecheck           # TypeScript 类型检查 + 合约校验
pnpm test                # Vitest 单元测试
pnpm test:ui             # Vitest 可视化界面
pnpm test:watch          # Vitest 监听模式
pnpm e2e                 # Playwright e2e 测试
pnpm e2e:ui              # Playwright 可视化界面

# 发布
pnpm release -v 0.8.0     # 完整发布管线
pnpm release -v 0.8.0 -d  # 预演（仅预览，不实际执行）

# 工具
pnpm doctor              # 运行 react-doctor 代码健康检查
pnpm build:updater       # 生成更新器生产配置
```

---

## 🌍 国际化（i18n）

OnePublish 开箱即支持**简体中文**和 **English**。可通过应用设置切换，或编程方式切换：

```typescript
// 应用读取 localStorage('app-language')
// 可选值：'zh'（默认）或 'en'
```

翻译文件：`src/i18n/zh.json` | `src/i18n/en.json`（各约 790 个条目，按功能域组织）。

---

## 🧪 测试

| 层级 | 工具 | 覆盖范围 |
|------|------|----------|
| 前端单元 | Vitest + Testing Library | 组件、hooks、stores、lib |
| 后端单元 | Rust `#[cfg(test)]` | Provider 编译、store 迁移、plan 生成 |
| E2E | Playwright（13+ 用例） | 应用启动、仓库面板、provider 选择、发布预设、自定义配置、预检、合约冒烟 |
| 质量门 | TypeScript strict + `ts-rs` 合约 | 构建与 CI 强制校验 |

---

## 🗺️ 路线图

OnePublish 正从 .NET 发布 GUI 进化为**商业级多语言发布产品**。[总体规划](docs/roadmap/MASTER_PLAN.md)涵盖 11 个阶段：

| 阶段 | 主题 | 状态 |
|------|------|------|
| 0 | 工程基础（测试、CI） | ✅ 已完成 |
| 1 | 发布核心抽象（Spec、Plan、日志） | ✅ 已完成 |
| 2 | 语言 provider（Rust/Go/Java） | ✅ 已完成 |
| 3 | 100% 参数表达能力（Schema 编辑器） | ✅ 已完成 |
| 4 | 商业特性（导入/导出、环境检查、签名） | ✅ 已完成 |
| 5 | 发布操作体验（检查清单向导、预检） | ✅ 已完成 |
| 6 | 多 provider 体验桥接 | ✅ 已完成 |
| 7 | 执行可靠性与开发体验（流式输出、取消、快照） | ✅ 已完成 |
| 8 | 运行智能与恢复（历史、重跑、失败归类） | ✅ 已完成 |
| 9 | 诊断深化与团队交接 | ✅ 已完成 |
| 10 | 协作信号与时间线智能 | ✅ 已完成 |
| 11 | 团队工作流集成 | 🚧 进行中 |

---

## 🤝 参与贡献

1. Fork 本仓库
2. 创建特性分支（`git checkout -b feat/amazing-feature`）
3. 运行测试（`pnpm test && pnpm e2e`）
4. 提交描述清晰的 commit
5. 推送并打开 Pull Request

详见 [CLAUDE.md](CLAUDE.md) 获取面向 AI 助手的详细开发指引。

---

## 📄 许可证

MIT © 2026 Eric Tao — 详见 [LICENSE](LICENSE)。

---

<div align="center">

Made with ❤️ by [Eric Tao](https://github.com/sperictao)

</div>
