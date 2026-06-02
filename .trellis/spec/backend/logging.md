# Backend Logging

Logging is handled by `tauri-plugin-log` and Rust `log::*` macros.

## Plugin Setup

`src-tauri/src/lib.rs` builds the log plugin:

- Debug builds clear default targets and write to stdout.
- Release builds use the plugin defaults.

Do not add a second logging framework for command diagnostics.

## Command Timing

Tauri command functions should create a timer at the top of the function:

```rust
let _timer = crate::commands::middleware::CommandTimer::new(
    "commands::repository::scanner::detect_repository_provider",
);
```

`CommandTimer` logs start at debug level and completion duration at info level when dropped. The helper lives in `src-tauri/src/commands/middleware.rs`.

## Log Levels

- Use `log::info!` for lifecycle milestones such as window sizing, tray setup, publish execution, or completed pre-publish cleanup.
- Use `log::warn!` when a non-fatal integration step fails, such as emitting an event or refreshing the tray menu.
- Use `log::error!` for startup/setup failures that should be visible during diagnosis.
- Avoid logging secrets, full tokens, or exported config values. Use sanitization helpers before writing diagnostic exports.

## Streaming Publish Logs

Publish process output is not only backend logging. It is emitted to the renderer through Tauri events:

- Event name: `provider-publish-log`
- Payload type: `PublishLogChunkEvent`
- Source: `src-tauri/src/commands/publish/logs.rs`

The helper prefixes stderr chunks with `[stderr]` and collects a summary for `PublishResult.output_log`.

Reference files:

- `src-tauri/src/lib.rs`
- `src-tauri/src/commands/middleware.rs`
- `src-tauri/src/commands/publish/execution.rs`
- `src-tauri/src/commands/publish/logs.rs`
- `src-tauri/src/security.rs`

