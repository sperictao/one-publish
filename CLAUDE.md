# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

One Publish is a cross-platform .NET publish tool with a desktop GUI. It helps developers publish .NET projects by providing preset configurations and custom publish options through a native desktop interface.

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite 7
- **Backend**: Rust + Tauri 2
- **Styling**: Tailwind CSS + shadcn/ui (Radix UI primitives)
- **State Management**: Zustand 5
- **Type Bridging**: ts-rs (Rust → TypeScript type generation)
- **Package Manager**: pnpm

## Common Commands

```bash
# Development
pnpm dev              # Start Tauri dev mode (frontend + backend)
pnpm dev:renderer     # Start Vite dev server only (frontend)

# Build
pnpm build            # Build production app (Tauri bundle)
pnpm build:renderer   # Build frontend only

# Quality
pnpm typecheck        # TS type-check + contract validation (ts-rs drift check)
pnpm test             # Vitest unit tests
pnpm test:ui          # Vitest UI mode
pnpm test:watch       # Vitest watch mode
pnpm e2e              # Playwright e2e tests (13+ specs)
pnpm e2e:ui           # Playwright UI mode
pnpm doctor           # Run react-doctor code health check

# Rust backend
cd src-tauri && cargo check    # Type-check Rust code
cd src-tauri && cargo test     # Run Rust unit tests
cd src-tauri && cargo clippy   # Lint Rust code

# Contracts
pnpm generate:contracts        # Regenerate src/generated/tauri-contracts.ts from Rust types
pnpm check:contracts           # Verify generated contracts match Rust source

# Release
pnpm release -v 0.8.0          # Full release pipeline (version bump, changelog, tag, push)
pnpm release -v 0.8.0 -d       # Dry-run (preview only)

# Utilities
pnpm check:i18n                # Check i18n key coverage across zh/en
pnpm build:updater             # Generate updater production config
```
