# Tauri Command Registration

## Problem

A Rust command function exists, but the renderer `invoke(...)` call fails or never reaches it.

## Current Registration Chain

For a command under `src-tauri/src/commands/`:

1. The function has `#[tauri::command]`.
2. The module exports both the command and generated `__cmd__*` symbol through `src-tauri/src/commands/mod.rs`.
3. `src-tauri/src/lib.rs` lists the command inside `tauri::generate_handler![...]`.
4. The frontend wrapper calls the exact command name.

Store commands in `src-tauri/src/store/commands.rs` are registered directly from `src-tauri/src/lib.rs`.

## Evidence

- `src-tauri/src/commands/repository/scanner.rs`
- `src-tauri/src/commands/mod.rs`
- `src-tauri/src/lib.rs`
- `src/lib/store/api.ts`
- `src/features/publish/publishRuntime.ts`

## Prevention

When adding a new command, update all registration points in the same change and add a wrapper test that asserts the command name and payload.

