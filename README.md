<div align="center">

<img src="src-tauri/icons/128x128@2x.png" alt="OnePublish Icon" width="128" height="128" />

# OnePublish

**Multi-Language Project Publishing, Beautifully Simplified.**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Tauri 2](https://img.shields.io/badge/Tauri-2.x-FFC131?logo=tauri&logoColor=white)](https://tauri.app)
[![React 18](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Rust](https://img.shields.io/badge/Rust-1.77+-DEA584?logo=rust&logoColor=white)](https://www.rust-lang.org)

</div>

---

<p align="center">
  <strong><a href="#english">English</a></strong> &nbsp;|&nbsp;
  <strong><a href="#chinese-中文">中文</a></strong>
</p>

---

<a name="english"></a>

## English

### What is OnePublish?

OnePublish is a **cross-platform desktop application** that gives you a beautiful, productive GUI for publishing software projects. Instead of remembering and typing complex CLI commands, you select a repository, configure parameters through an intelligent form, and publish with a single click.

**One tool. Multiple languages.** .NET · Rust (cargo) · Go · Java (Gradle) — all from the same unified interface.

### ✨ Highlights

- 🎯 **Multi-Language Support** — .NET (`dotnet publish`), Rust (`cargo build --release`), Go (`go build`), Java/Gradle — with more coming
- 🧠 **Schema-Driven Parameters** — 100% parameter expressiveness: every CLI flag, env var, and argument is represented and validated, not hardcoded
- 📋 **Command Import** — paste any CLI command and OnePublish reverse-engineers it into structured parameters
- 📊 **Execution History** — local timeline of your last 20+ runs with one-click re-run
- 🔍 **Environment Diagnostics** — automatic detection of missing toolchains (SDKs, runtimes) with guided fixes
- 🎨 **Apple Liquid Glass Design** — macOS-inspired UI with backdrop-blur glass materials, spring animations, and specular highlights
- 🌐 **Internationalized** — full Chinese (简体中文) and English support
- 🌓 **Dark & Light Themes** — follows your system preference
- 🔄 **Auto-Update** — Tauri updater pipeline with GitHub Releases integration
- ⌨️ **Keyboard-First** — global shortcuts for frequent actions; publish without touching the mouse
- 📦 **One-Click GitHub Release** — `pnpm release -v 1.0.0` syncs versions, generates release notes, commits, tags, pushes, and waits for CI

---

### 📸 Screenshots

<!-- TODO: add actual screenshots -->
> *Screenshots coming soon. In the meantime, check the [design philosophy](docs/design-philosophy.md) and [Liquid Glass design system](docs/liquid-glass-design-system.md).*

---

### 🚀 Quick Start

#### Prerequisites

| Required | Version | Purpose |
|----------|---------|---------|
| **Node.js** | ≥ 18 | Frontend runtime |
| **pnpm** | latest | Package manager |
| **Rust** | ≥ 1.77 | Tauri backend compilation |
| **Target SDK** | varies | At least one of: .NET SDK / Rust / Go / Java (Gradle) |

#### macOS — Install Dev Dependencies

```bash
# Xcode Command Line Tools (required for Tauri on macOS)
xcode-select --install

# Node.js & pnpm
brew install node pnpm

# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

#### Linux — Install Dev Dependencies

```bash
# Ubuntu/Debian
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev

# Fedora
sudo dnf install webkit2gtk4.1-devel openssl-devel libappindicator-gtk3-devel \
  librsvg2-devel
```

#### Windows — Install Dev Dependencies

```bash
# With Chocolatey
choco install nodejs pnpm rust
# Or via official installers: nodejs.org, rustup.rs
```

#### Build & Run

```bash
# Clone
git clone https://github.com/sperictao/one-publish.git
cd one-publish

# Install dependencies
pnpm install

# Development mode (hot-reload)
pnpm dev

# Production build
pnpm build
# Output: src-tauri/target/release/bundle/
```

---

### 🏗️ Architecture

```
one-publish/
├── src/                          # React Frontend (TypeScript)
│   ├── components/
│   │   ├── ui/                   # shadcn/ui primitives (Button, Dialog, Select...)
│   │   ├── layout/               # Layout: panels, resize handles, sidebar
│   │   ├── publish/              # Publish config: parameter editors, command import
│   │   ├── release/              # Release checklist wizard
│   │   └── environment/          # Environment diagnostics UI
│   ├── features/                 # Domain logic: publish, repository, provider, environment
│   ├── hooks/                    # React hooks: useI18n, useAppState, useShortcuts...
│   ├── stores/                   # Zustand state slices
│   ├── lib/                      # Utilities: store API, paths, preflight, artifacts
│   ├── i18n/                     # Translations: zh.json, en.json
│   └── index.css                 # Liquid Glass design tokens + utilities
│
├── src-tauri/                    # Rust Backend (Tauri)
│   ├── src/
│   │   ├── main.rs               # Entry point
│   │   ├── lib.rs                # Plugin registration + command handler
│   │   ├── provider/             # Language provider trait + implementations
│   │   │   └── providers/        # dotnet.rs, cargo.rs, go.rs, java_gradle.rs
│   │   ├── commands/             # Tauri IPC commands (publish, repository, updater)
│   │   ├── environment/          # Environment checks per language
│   │   ├── compiler.rs           # Spec → ExecutionPlan compiler
│   │   ├── spec.rs               # PublishSpec (language-agnostic data model)
│   │   ├── plan.rs               # ExecutionPlan (ordered steps)
│   │   ├── parameter.rs          # ParameterSchema + validation
│   │   ├── store/                # Persistence (JSON file storage)
│   │   ├── config_export.rs      # Config import/export
│   │   ├── shortcuts.rs          # Global hotkey registration
│   │   └── tray.rs               # System tray
│   ├── Cargo.toml                # Rust dependencies
│   └── tauri.conf.json           # Tauri window, bundle, updater config
│
├── tests/e2e/                    # Playwright e2e tests
├── scripts/                      # Build/Release automation scripts
├── docs/                         # Documentation
│   ├── design-philosophy.md      # Product & engineering philosophy
│   ├── liquid-glass-design-system.md
│   ├── roadmap/MASTER_PLAN.md    # Development roadmap (11 phases)
│   ├── updater/SETUP.md          # Updater configuration guide
│   └── release/GITHUB_RELEASE.md # Release pipeline docs
├── DESIGN.md                     # Apple design analysis (reference)
├── package.json
├── vite.config.ts
├── tailwind.config.cjs
└── tsconfig.json
```

---

### 🧩 How It Works

> **PublishSpec → ExecutionPlan → Execute**

1. **Select a repository** — Auto-detected from local files (`.sln`, `Cargo.toml`, `go.mod`, `build.gradle`, etc.)
2. **Configure publish parameters** — Use presets, a schema-driven form, or paste a raw CLI command
3. **Preflight check** — Validates output paths, environment readiness, branch status
4. **Execute** — Streams live `stdout`/`stderr` into the UI with cancel support
5. **Review** — History timeline stores every run; re-run with one click, export diagnostics, or generate CI handoff snippets

---

### 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend Framework** | React 18 + TypeScript |
| **Build Tool** | Vite 7 |
| **Styling** | Tailwind CSS 3 + shadcn/ui (Radix UI) |
| **Design System** | Apple Liquid Glass (backdrop-blur, spring physics, specular highlights) |
| **State Management** | Zustand 5 |
| **Icons** | Lucide React |
| **Notifications** | Sonner |
| **Desktop Framework** | Tauri 2.x (Rust) |
| **Persistence** | JSON file storage (`~/.one-publish/config.json`) |
| **Type Bridging** | `ts-rs` (Rust ↔ TypeScript contract generation) |
| **Unit Testing** | Vitest (frontend) + Rust `#[cfg(test)]` (backend) |
| **E2E Testing** | Playwright |
| **Package Manager** | pnpm |

---

### 📜 Available Scripts

```bash
# Development
pnpm dev                 # Full Tauri dev (frontend + backend)
pnpm dev:renderer        # Vite dev server only (frontend)

# Build
pnpm build               # Production Tauri bundle
pnpm build:renderer      # Frontend build only

# Quality
pnpm typecheck           # TypeScript type check + contract validation
pnpm test                # Vitest unit tests
pnpm test:ui             # Vitest UI
pnpm test:watch          # Vitest watch mode
pnpm e2e                 # Playwright e2e tests
pnpm e2e:ui              # Playwright UI mode

# Release
pnpm release -v 0.8.0     # Full release pipeline
pnpm release -v 0.8.0 -d  # Dry-run (preview only)

# Utilities
pnpm doctor              # Run react-doctor for code health
pnpm build:updater       # Generate updater production config
```

---

### 🌍 Internationalization (i18n)

OnePublish supports **简体中文** and **English** out of the box. Switch in-app via Settings, or programmatically:

```typescript
// The app reads localStorage('app-language')
// Values: 'zh' (default) or 'en'
```

Translation files: `src/i18n/zh.json` | `src/i18n/en.json` (~790 keys each, organized by feature domain)

---

### 🧪 Testing

| Layer | Tool | Coverage |
|-------|------|----------|
| Frontend unit | Vitest + Testing Library | Components, hooks, stores, lib |
| Backend unit | Rust `#[cfg(test)]` | Provider compilation, store migrations, plan generation |
| E2E | Playwright (13+ specs) | App boot, repo panel, provider selection, publish presets, custom config, preflight, contracts smoke |
| Quality gates | TypeScript strict + `ts-rs` contracts | Enforced at build & CI |

---

### 🗺️ Roadmap

OnePublish is evolving from a .NET publish GUI into a **commercial-grade, multi-language publishing product**. The [master plan](docs/roadmap/MASTER_PLAN.md) spans 11 phases:

| Phase | Theme | Status |
|-------|-------|--------|
| 0 | Engineering foundation (testing, CI) | ✅ Done |
| 1 | Publish core abstraction (Spec, Plan, Logging) | ✅ Done |
| 2 | Language providers (Rust/Go/Java) | ✅ Done |
| 3 | 100% parameter expressiveness (schema editor) | ✅ Done |
| 4 | Commercial features (import/export, env checks, signing) | ✅ Done |
| 5 | Release operations UX (checklist wizard, preflight) | ✅ Done |
| 6 | Multi-provider UX bridge | ✅ Done |
| 7 | Execution reliability & DevEx (streaming, cancel, snapshots) | ✅ Done |
| 8 | Run intelligence & recovery (history, re-run, failure grouping) | ✅ Done |
| 9 | Diagnostics deepening & team handoff | ✅ Done |
| 10 | Collaboration signal & timeline intelligence | ✅ Done |
| 11 | Team workflow integration | 🚧 In Progress |

---

### 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/amazing-feature`)
3. Run tests (`pnpm test && pnpm e2e`)
4. Commit with descriptive messages
5. Push and open a Pull Request

See [CLAUDE.md](CLAUDE.md) for detailed development instructions (AI assistant-friendly).

---

### 📄 License

MIT © 2026 Eric Tao — see [LICENSE](LICENSE) for details.

---

<a name="chinese-中文"></a>

## 中文

### OnePublish 是什么？

OnePublish 是一个**跨平台桌面应用**，为软件项目发布提供美观高效的图形化界面。无需记忆复杂的命令行参数——选择仓库、配置参数、一键发布。

**一个工具，多种语言。** .NET · Rust (cargo) · Go · Java (Gradle) — 统一界面，统一体验。

### ✨ 核心亮点

- 🎯 **多语言发布** — 支持 .NET (`dotnet publish`)、Rust (`cargo build --release`)、Go (`go build`)、Java/Gradle，更多语言持续接入
- 🧠 **Schema 驱动参数** — 100% 参数表达能力：所有 CLI 标志、环境变量、参数均可表示与校验，非硬编码
- 📋 **命令导入** — 粘贴任意 CLI 命令，OnePublish 自动逆向解析为结构化参数
- 📊 **执行历史** — 本地保留最近 20+ 次运行记录，一键重跑
- 🔍 **环境诊断** — 自动检测缺失的工具链（SDK、运行时），提供引导式修复
- 🎨 **Apple Liquid Glass 设计** — macOS 风格界面：毛玻璃材质、弹簧动画、镜面高光
- 🌐 **国际化** — 完整支持简体中文和 English
- 🌓 **深色/浅色主题** — 跟随系统偏好自动切换
- 🔄 **自动更新** — Tauri 内置更新管线，集成 GitHub Releases
- ⌨️ **键盘优先** — 全局快捷键覆盖高频操作，无需鼠标即可发布
- 📦 **一键 GitHub Release** — `pnpm release -v 1.0.0` 同步版本、生成发布说明、提交、打标签、推送并等待 CI 完成

### 🚀 快速开始

#### 环境要求

| 依赖 | 版本 | 用途 |
|------|------|------|
| **Node.js** | ≥ 18 | 前端运行时 |
| **pnpm** | 最新版 | 包管理器 |
| **Rust** | ≥ 1.77 | Tauri 后端编译 |
| **目标 SDK** | 按需 | 至少安装一种：.NET SDK / Rust / Go / Java (Gradle) |

#### 安装与运行

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

> 各平台额外依赖请参考上方英文版 "Install Dev Dependencies" 章节。

### 🏗️ 架构概览

| 层级 | 技术 | 说明 |
|------|------|------|
| **前端** | React 18 + TypeScript + Vite 7 | 三栏布局：仓库列表 | 发布配置 | 执行输出 |
| **样式** | Tailwind CSS 3 + shadcn/ui | Liquid Glass 毛玻璃设计系统 |
| **状态管理** | Zustand 5 | 切片式状态（仓库、发布、UI、偏好、收藏） |
| **后端** | Rust + Tauri 2.x | 系统能力：文件扫描、进程执行、全局快捷键、托盘 |
| **抽象层** | Provider Trait | 语言无关的 PublishSpec → ExecutionPlan 编译管线 |
| **类型桥接** | `ts-rs` | Rust 结构体自动生成 TypeScript 类型合约 |
| **持久化** | JSON 文件 | `~/.one-publish/config.json` |
| **测试** | Vitest + Playwright + Rust 单元测试 | 组件/逻辑/E2E 全覆盖 |

### 🧩 核心工作流

> **PublishSpec → ExecutionPlan → Execute**

1. **选择仓库** — 自动扫描本地项目文件（`.sln`、`Cargo.toml`、`go.mod`、`build.gradle` 等）
2. **配置参数** — 使用预设、Schema 驱动表单或粘贴 CLI 命令
3. **预检** — 验证输出路径、环境就绪状态、分支状况
4. **执行** — 实时流式输出 `stdout`/`stderr`，支持随时取消
5. **回顾** — 历史时间线记录每次运行；一键重跑、导出诊断、生成 CI 交接片段

### 📜 常用命令

```bash
pnpm dev              # 开发模式
pnpm build            # 生产构建
pnpm typecheck        # 类型检查 + Rust↔TS 合约校验
pnpm test             # 单元测试
pnpm e2e              # E2E 测试
pnpm release -v 0.8.0 # 一键发布
```

### 🗺️ 路线图

详见 [MASTER_PLAN.md](docs/roadmap/MASTER_PLAN.md)，当前已完成 Phase 0–10，Phase 11（团队工作流集成）进行中。

### 📄 许可证

MIT © 2026 Eric Tao

---

<div align="center">

Made with ❤️ by [Eric Tao](https://github.com/sperictao)

</div>
