# Tauri Setup

This project uses pnpm for frontend scripts and Cargo/Tauri for the backend app.

## Scripts

Current scripts are defined in `package.json`:

- `pnpm dev` -> `pnpm tauri dev`
- `pnpm build` -> `pnpm tauri build`
- `pnpm generate:contracts` -> runs the Rust `generate_tauri_contracts` example
- `pnpm check:contracts` -> verifies generated contract drift
- `pnpm typecheck` -> runs contract check and `tsc --noEmit`
- `pnpm test` -> Vitest
- `pnpm e2e` -> Playwright

## Tauri Files

- `src-tauri/Cargo.toml`: Rust crate dependencies and Tauri plugins.
- `src-tauri/tauri.conf.json`: app configuration.
- `src-tauri/capabilities/default.json`: Tauri permissions for the main window.
- `src-tauri/src/lib.rs`: plugin setup, app setup, command registration.

## Current Dependencies To Respect

- Tauri 2 plugins are used for dialog, process, shell, updater, notification, global shortcuts, decorum, logging, opener, and single-instance behavior.
- There is no pnpm hoisted-node-modules requirement documented by current code.
