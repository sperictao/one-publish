# Security And Permission Boundaries

This repo currently has no application login/session authentication layer. Do not invent login middleware or route guards in specs or implementations. The real boundary is Tauri capability configuration plus explicit command-level validation for local filesystem and process operations.

## Tauri Capabilities

The current capability file is `src-tauri/capabilities/default.json`.

It grants the main window:

- Core defaults.
- Window drag/toggle maximize permissions.
- Dialog open permissions.
- Process and opener defaults.

Before adding a plugin permission, check whether an existing Tauri plugin already covers the need and keep the capability change narrow.

## Command-Level Validation

Commands must validate local inputs before side effects:

- Path existence and type checks appear in repository scanning commands.
- Publish output checks run before execution through `ensure_publish_output_preflight`.
- Protected/macOS output access is represented by structured preflight statuses rather than guessed from the renderer.
- Remote publish targets are rejected until the upload pipeline exists.

Reference files:

- `src-tauri/src/commands/repository/scanner.rs`
- `src-tauri/src/commands/publish/execution.rs`
- `src-tauri/src/commands/publish/preflight/mod.rs`
- `src-tauri/tests/preflight_access.rs`

## Sanitization And Private Files

Use `src-tauri/src/security.rs` for shared export and private-file rules:

- Sensitive keys such as token/password/secret become `<redacted>`.
- Absolute local paths in exports/log-like freeform fields become `<local-path>`.
- Private parent directories use owner-only permissions on Unix.
- Private files use owner-only permissions where supported.

Reference files:

- `src-tauri/src/security.rs`
- `src-tauri/src/config_export.rs`
- `src-tauri/src/commands/config.rs`

## Frontend Permission Errors

Frontend code should use backend error codes/details where available instead of string-only guessing. Existing invoke error helpers live in `src/lib/tauri/invokeErrors.ts`, with examples in repository and branch refresh flows.

Do not add silent fallbacks that pretend a permission-sensitive command succeeded. Show a user-visible error or keep the failure explicit.
