# Tauri Command Surface

One Publish exposes backend behavior through Tauri commands, not HTTP routes.

## Where Commands Live

- Feature commands live in focused Rust modules under `src-tauri/src/commands/`.
- Store commands live in `src-tauri/src/store/commands.rs`.
- `src-tauri/src/commands/mod.rs` re-exports command functions and generated `__cmd__*` symbols.
- `src-tauri/src/lib.rs` registers the full command surface in `tauri::generate_handler![...]`.

Reference files:

- `src-tauri/src/lib.rs`
- `src-tauri/src/commands/mod.rs`
- `src-tauri/src/commands/repository/scanner.rs`
- `src-tauri/src/commands/publish/execution.rs`
- `src-tauri/src/store/commands.rs`

## Command Shape

Use the existing shape:

- Annotate exported command functions with `#[tauri::command]`.
- Return `Result<T, crate::errors::AppError>` for fallible commands.
- Start command bodies with `CommandTimer::new("module::path::function_name")`.
- Keep command boundary logic thin enough to validate/shape inputs, then delegate to domain helpers.
- Use explicit error codes through `AppError::*_with_code(...)` when the frontend distinguishes failure reasons.

Representative examples:

- `detect_repository_provider` validates path existence, directory shape, and read access before provider detection.
- `export_config` sanitizes profile parameters before writing a private JSON file.
- `execute_publish_spec` renders, preflights, reserves a session, emits logs, and returns a structured `PublishResult`.

## Frontend Wrapper Pattern

Do not call `invoke` from arbitrary components when a shared wrapper already exists.

Current wrappers:

- Store/repository/profile/updater commands: `src/lib/store/api.ts`
- Publish runtime commands: `src/features/publish/publishRuntime.ts`

Wrapper responsibilities:

- Use generated types from `src/generated/tauri-contracts.ts`.
- Convert Rust field names to frontend store shape when needed.
- Keep command names as string literals matching `#[tauri::command]` function names.
- Surface errors to hooks/components instead of swallowing them.

Tests should verify wrappers call the right command with the right payload. See `src/lib/__tests__/publishRuntime.test.ts`.

## Adding A New Command

When a feature needs a new backend API:

1. Add the command to the narrowest `src-tauri/src/commands/<domain>.rs` module or store command module.
2. Re-export it in `src-tauri/src/commands/mod.rs` when it is in the commands tree.
3. Register it in `tauri::generate_handler![...]` in `src-tauri/src/lib.rs`.
4. Add or update generated contract exports if the payload type crosses the TS boundary.
5. Add a TS wrapper beside the closest existing wrapper.
6. Add targeted Rust and/or Vitest coverage.

Avoid creating parallel command names, duplicate wrappers, or ad hoc component-level `invoke` calls.
