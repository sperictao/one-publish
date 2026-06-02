# Current Pitfalls

These are project-backed pitfalls for the current Tauri + React app. Do not use outdated pitfall docs for this repository.

## Tauri Boundary

| Document | Severity | Summary |
| --- | --- | --- |
| [tauri-command-registration.md](./tauri-command-registration.md) | P1 | New Rust command exists but renderer cannot invoke it |
| [tauri-contract-drift.md](./tauri-contract-drift.md) | P1 | Rust payload changed but generated TypeScript contracts are stale |

## Publish / Filesystem

| Document | Severity | Summary |
| --- | --- | --- |
| [publish-output-preflight.md](./publish-output-preflight.md) | P1 | Publish proceeds without matching path/access validation |

## Frontend

| Document | Severity | Summary |
| --- | --- | --- |
| [react-usestate-function.md](./react-usestate-function.md) | P2 | Storing function values in React state executes them as updaters |
| [css-flex-centering.md](./css-flex-centering.md) | P2 | Flex centering can look visually too low under headers |

## Quick Debugging

### Tauri command not found

1. Check the command has `#[tauri::command]`.
2. Check it is re-exported through `src-tauri/src/commands/mod.rs` if it lives under `commands/`.
3. Check it is listed in `tauri::generate_handler![...]` in `src-tauri/src/lib.rs`.
4. Check the frontend wrapper uses the exact command name.

### TypeScript payload shape is wrong

1. Check whether the Rust type is exported in `src-tauri/src/contracts.rs`.
2. Run `pnpm check:contracts`.
3. Update wrapper normalization if Rust field names differ from frontend shape.

### Publish fails before execution

1. Check `preflight_publish_output` result.
2. Check validation/access status and error code.
3. Check whether the target is remote, mounted remote, protected macOS folder, or cross-platform path syntax.
