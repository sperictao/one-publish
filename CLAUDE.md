# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

One Publish is a cross-platform .NET publish tool with a desktop GUI. It helps developers publish .NET projects by providing preset configurations and custom publish options through a native desktop interface.

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite 7
- **Backend**: Rust + Tauri 2
- **Styling**: Tailwind CSS + shadcn/ui (Radix UI primitives)
- **Package Manager**: pnpm

## Common Commands

```bash
# Development
pnpm dev              # Start Tauri dev mode (frontend + backend)
pnpm dev:renderer     # Start Vite dev server only (frontend)

# Build
pnpm build            # Build production app (Tauri bundle)
pnpm build:renderer   # Build frontend only

# Type checking
pnpm typecheck        # Run TypeScript type check

# Rust backend
cd src-tauri && cargo check   # Check Rust code
cd src-tauri && cargo test    # Run Rust tests
cd src-tauri && cargo clippy  # Lint Rust code
```

## Architecture

```
one-publish/
├── src/                      # React frontend
│   ├── main.tsx              # App entry point
│   ├── App.tsx               # Main app component (三列布局)
│   ├── components/
│   │   ├── ui/               # shadcn/ui components (Button, Card, Select, etc.)
│   │   └── layout/           # Layout components (CollapsiblePanel, ResizeHandle, etc.)
│   ├── hooks/
│   │   └── useAppState.ts    # Persistent state management hook
│   ├── lib/
│   │   ├── utils.ts          # Utility functions (cn for className merging)
│   │   └── store.ts          # Store API for persistence
│   └── types/                # TypeScript type definitions
│
├── src-tauri/                # Rust backend (Tauri)
│   ├── src/
│   │   ├── main.rs           # Tauri entry point
│   │   ├── lib.rs            # Library entry (plugin registration)
│   │   ├── commands.rs       # Tauri IPC commands (scan_project, execute_publish)
│   │   └── store.rs          # Persistence module (JSON file storage)
│   ├── Cargo.toml            # Rust dependencies
│   └── tauri.conf.json       # Tauri configuration
```

## Key Patterns

### Tauri IPC Commands

Frontend calls Rust backend via `invoke()`:
```typescript
import { invoke } from "@tauri-apps/api/core";
const result = await invoke<ProjectInfo>("scan_project", { startPath: path });
```

Commands are defined in `src-tauri/src/commands.rs` and registered in `lib.rs`:
- `scan_project`: Scans directory for .NET projects (.sln, .csproj)
- `execute_publish`: Executes `dotnet publish` with given configuration

### Data Persistence

Application state is persisted to `~/.one-publish/config.json` using a simple JSON file storage pattern (inspired by cc-switch).

**Persisted Data:**
- `repositories`: List of added repositories
- `selectedRepoId`: Currently selected repository
- `leftPanelWidth` / `middlePanelWidth`: Panel widths
- `selectedPreset`: Selected publish preset
- `isCustomMode`: Whether using custom mode
- `customConfig`: Custom publish configuration

**Frontend Usage:**
```typescript
import { useAppState } from "@/hooks/useAppState";

const { repositories, addRepository, selectRepository, ... } = useAppState();
```

**Backend Commands (store.rs):**
- `get_app_state`: Load persisted state
- `save_app_state`: Save complete state
- `add_repository` / `remove_repository` / `update_repository`: Repository CRUD
- `update_ui_state`: Update panel widths and selection
- `update_publish_state`: Update publish configuration

### UI Components

Uses shadcn/ui pattern with `@/` path alias:
```typescript
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
```

### Window Drag Region

Custom title bar with drag support using `data-tauri-drag-region` attribute.

## Tauri Plugins in Use

- `tauri-plugin-dialog`: Native file/folder dialogs
- `tauri-plugin-shell`: Execute shell commands
- `tauri-plugin-process`: Process management
- `tauri-plugin-log`: Logging
- `tauri-plugin-opener`: Open files/URLs

## Notes

- UI language is Chinese (中文)
- Minimum Rust version: 1.77.0
- Minimum macOS version: 10.15
- Window uses overlay title bar style (titleBarStyle: "Overlay")
