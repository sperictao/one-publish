# Tauri API Usage From The Renderer

Renderer code talks to Rust with `@tauri-apps/api/core` `invoke`, but the repo centralizes those calls behind small TypeScript modules.

## Wrapper Locations

- `src/lib/store/api.ts`: app state, repositories, profiles, config import/export, updater, tray, execution history.
- `src/features/publish/publishRuntime.ts`: publish render/preflight/execute/cancel and command import.
- `src/lib/tauri/invokeErrors.ts`: shared helpers for extracting error message/code and classifying invoke failures.

Do not scatter new `invoke(...)` calls in components when an existing domain wrapper is the right boundary.

## Wrapper Responsibilities

Wrappers should:

- Use types from `src/generated/tauri-contracts.ts`.
- Match Tauri command names exactly, for example `execute_provider_publish`.
- Translate Rust payload fields only when the frontend store uses a different shape.
- Return promises and let hooks/components decide user feedback.
- Keep error handling explicit; do not turn backend failures into fake success states.

Reference tests:

- `src/lib/__tests__/publishRuntime.test.ts`

## Command Error Handling

Use `extractInvokeErrorMessage` and `extractInvokeErrorCode` when UI behavior depends on backend error categories. Existing repository flows classify permission, missing path, unsupported provider, and branch refresh failures in `src/lib/tauri/invokeErrors.ts`.

Prefer backend `AppError.code` values over broad substring matching when the code exists.

