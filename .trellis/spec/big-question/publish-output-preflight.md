# Publish Output Preflight

## Problem

Publish execution can be unsafe or misleading if path validation/access checks are bypassed.

## Current Invariant

`execute_publish_spec` must call `ensure_publish_output_preflight(&spec)` before spawning the provider command.

That preflight checks:

- Cross-platform path syntax compatibility.
- Missing Windows drive/share roots.
- macOS protected folder access.
- Cleanup access when `delete_existing_files` is enabled.
- Remote targets that are not implemented yet.

## Evidence

- `src-tauri/src/commands/publish/execution.rs`
- `src-tauri/src/commands/publish/preflight/mod.rs`
- `src-tauri/src/commands/publish/preflight/access.rs`
- `src-tauri/tests/preflight_access.rs`
- `src-tauri/tests/publish_roundtrip.rs`

## Frontend Pattern

Use `preflightProviderPublishOutput(spec)` from `src/features/publish/publishRuntime.ts` and surface the structured result. Do not duplicate preflight rules in React as a second source of truth.

