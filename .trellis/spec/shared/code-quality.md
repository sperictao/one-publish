# Code Quality Guidelines

These rules apply across the current Tauri backend and React frontend.

## Keep Changes Scoped

- Match existing module boundaries.
- Do not add speculative abstractions for one-off behavior.
- Do not refactor adjacent code unless the requested change requires it.
- Remove only dead code introduced by your own change unless explicitly asked.

## Error Handling

- Let failures surface clearly.
- Do not swallow backend command failures or replace them with fake success.
- Prefer structured Rust `AppError` codes when frontend behavior branches on error type.
- Renderer validation is UX only; Rust commands remain authoritative for filesystem, process, import/export, and persisted state checks.

## Validation Commands

Use the checks that match the files changed:

- Rust backend: `cargo test --manifest-path src-tauri/Cargo.toml`
- Tauri contract drift: `pnpm check:contracts`
- TypeScript units/components/hooks: `pnpm test`
- TypeScript + contracts: `pnpm typecheck`
- E2E smoke/workflows: `pnpm e2e`

## Frontend Rules

- Keep Tauri `invoke` calls centralized in wrapper modules.
- Use generated contracts for Tauri payloads.
- Keep forms controlled and accessible.
- Use local UI primitives from `src/components/ui/`.
- Avoid non-null assertions and `any` unless an existing tested boundary makes it unavoidable.

## Backend Rules

- Register new commands in both the Rust module exports and `tauri::generate_handler![...]`.
- Add `CommandTimer` at command boundaries.
- Validate paths and side-effect preconditions before writing, opening, deleting, or spawning.
- Sanitize exports/log-like payloads that may contain secrets or local paths.

