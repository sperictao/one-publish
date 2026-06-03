<div align="center">

<img src="src-tauri/icons/128x128@2x.png" alt="OnePublish Icon" width="128" height="128" />

# OnePublish

**Multi-Language Project Publishing, Beautifully Simplified.**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Tauri 2](https://img.shields.io/badge/Tauri-2.x-FFC131?logo=tauri&logoColor=white)](https://tauri.app)
[![React 18](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Rust](https://img.shields.io/badge/Rust-1.77+-DEA584?logo=rust&logoColor=white)](https://www.rust-lang.org)

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Português](README.pt-BR.md) · [Français](README.fr.md) · [Deutsch](README.de.md)

</div>

---

## What is OnePublish?

OnePublish is a **cross-platform desktop application** that gives you a beautiful, productive GUI for publishing software projects. Instead of remembering and typing complex CLI commands, you select a repository, configure parameters through an intelligent form, and publish with a single click.

**One tool. Multiple languages.** .NET · Rust (cargo) · Go · Java (Gradle) — all from the same unified interface.

## ✨ Highlights

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

## 📸 Screenshots

<!-- TODO: add actual screenshots -->
> *Screenshots coming soon. In the meantime, check the [design philosophy](docs/design-philosophy.md) and [Liquid Glass design system](docs/liquid-glass-design-system.md).*

---

## 🚀 Quick Start

### Prerequisites

| Required | Version | Purpose |
|----------|---------|---------|
| **Node.js** | ≥ 18 | Frontend runtime |
| **pnpm** | latest | Package manager |
| **Rust** | ≥ 1.77 | Tauri backend compilation |
| **Target SDK** | varies | At least one of: .NET SDK / Rust / Go / Java (Gradle) |

### macOS — Install Dev Dependencies

```bash
# Xcode Command Line Tools (required for Tauri on macOS)
xcode-select --install

# Node.js & pnpm
brew install node pnpm

# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### Linux — Install Dev Dependencies

```bash
# Ubuntu/Debian
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev

# Fedora
sudo dnf install webkit2gtk4.1-devel openssl-devel libappindicator-gtk3-devel \
  librsvg2-devel
```

### Windows — Install Dev Dependencies

```bash
# With Chocolatey
choco install nodejs pnpm rust
# Or via official installers: nodejs.org, rustup.rs
```

### Build & Run

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

## 🏗️ Architecture

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

## 🧩 How It Works

> **PublishSpec → ExecutionPlan → Execute**

1. **Select a repository** — Auto-detected from local files (`.sln`, `Cargo.toml`, `go.mod`, `build.gradle`, etc.)
2. **Configure publish parameters** — Use presets, a schema-driven form, or paste a raw CLI command
3. **Preflight check** — Validates output paths, environment readiness, branch status
4. **Execute** — Streams live `stdout`/`stderr` into the UI with cancel support
5. **Review** — History timeline stores every run; re-run with one click, export diagnostics, or generate CI handoff snippets

---

## 🛠️ Tech Stack

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

## 📜 Available Scripts

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

## 🌍 Internationalization (i18n)

OnePublish supports **简体中文** and **English** out of the box. Switch in-app via Settings, or programmatically:

```typescript
// The app reads localStorage('app-language')
// Values: 'zh' (default) or 'en'
```

Translation files: `src/i18n/zh.json` | `src/i18n/en.json` (~790 keys each, organized by feature domain).

---

## 🧪 Testing

| Layer | Tool | Coverage |
|-------|------|----------|
| Frontend unit | Vitest + Testing Library | Components, hooks, stores, lib |
| Backend unit | Rust `#[cfg(test)]` | Provider compilation, store migrations, plan generation |
| E2E | Playwright (13+ specs) | App boot, repo panel, provider selection, publish presets, custom config, preflight, contracts smoke |
| Quality gates | TypeScript strict + `ts-rs` contracts | Enforced at build & CI |

---

## 🗺️ Roadmap

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

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/amazing-feature`)
3. Run tests (`pnpm test && pnpm e2e`)
4. Commit with descriptive messages
5. Push and open a Pull Request

See [CLAUDE.md](CLAUDE.md) for detailed development instructions (AI assistant-friendly).

---

## 📄 License

MIT © 2026 Eric Tao — see [LICENSE](LICENSE) for details.

---

<div align="center">

Made with ❤️ by [Eric Tao](https://github.com/sperictao)

</div>
