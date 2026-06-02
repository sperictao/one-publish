# Backend Guidelines Index

> Current backend stack: Rust + Tauri 2 commands, Tauri plugins, serde/ts-rs contracts, local filesystem/store modules.

There are no HTTP API routes in this repo. Treat Tauri commands as the backend API surface.

## Pre-Development Checklist

Before editing Rust backend code:

- Read [tauri-commands.md](./tauri-commands.md) for command placement, registration, and frontend wrapper expectations.
- Read [security-permissions.md](./security-permissions.md) for the current security/permission boundary.
- Read [logging.md](./logging.md) before adding command logs or emitted log events.
- Read [contracts.md](./contracts.md) when changing any type returned to TypeScript.
- Read [testing.md](./testing.md) before adding command, preflight, provider, or store behavior.
- Search for an existing command in `src-tauri/src/commands/` or `src-tauri/src/store/commands.rs` before creating a new module.

## Documentation Files

| File | Description | When to Read |
| --- | --- | --- |
| [tauri-commands.md](./tauri-commands.md) | Tauri command modules, registration, TS wrappers | Adding or changing backend command APIs |
| [security-permissions.md](./security-permissions.md) | Capabilities, validation, sanitization, file access checks | Any filesystem, command execution, export, or permission-sensitive feature |
| [logging.md](./logging.md) | `tauri-plugin-log`, command timers, emitted publish logs | Adding diagnostics or command telemetry |
| [contracts.md](./contracts.md) | Rust-to-TypeScript contract generation | Changing shared payloads or generated types |
| [testing.md](./testing.md) | Rust unit/integration tests and validation commands | Adding or changing Rust behavior |

## Current Backend Patterns

| Concern | Current Pattern | Evidence |
| --- | --- | --- |
| API surface | `#[tauri::command]` functions registered in `tauri::generate_handler!` | `src-tauri/src/lib.rs`, `src-tauri/src/commands/mod.rs` |
| Frontend boundary | TS wrappers call `invoke("command_name", payload)` and normalize generated contract shapes | `src/lib/store/api.ts`, `src/features/publish/publishRuntime.ts` |
| Security/permissions | Tauri capabilities plus explicit command validation and filesystem probes; no app login/session authentication | `src-tauri/capabilities/default.json`, `src-tauri/src/security.rs`, `src-tauri/src/commands/publish/preflight/` |
| Logging | Tauri log plugin, `log::*`, `CommandTimer`, and `app.emit` for publish log chunks | `src-tauri/src/lib.rs`, `src-tauri/src/commands/middleware.rs`, `src-tauri/src/commands/publish/logs.rs` |
| Tests | Rust unit tests beside modules plus integration tests under `src-tauri/tests/` | `src-tauri/src/security.rs`, `src-tauri/src/commands/publish/preflight/mod.rs`, `src-tauri/tests/publish_roundtrip.rs` |

## Do Not Use Unsupported Runtime Patterns

- Do not introduce database or packaging assumptions that are not present in the current code.
- Do not model the backend as HTTP routes unless an actual HTTP server is added to the codebase.
- Do not add login middleware language unless the repo gains a real authentication layer.
