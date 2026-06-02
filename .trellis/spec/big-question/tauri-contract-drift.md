# Tauri Contract Drift

## Problem

Rust command payloads change, but `src/generated/tauri-contracts.ts` still contains the old TypeScript shape.

## Symptoms

- `pnpm typecheck` fails during `pnpm check:contracts`.
- Frontend wrappers compile against stale field names.
- Component tests fail because wrapper normalization no longer matches generated payloads.

## Source Of Truth

- Rust exported types are listed in `src-tauri/src/contracts.rs`.
- Generated output is `src/generated/tauri-contracts.ts`.
- Drift check is `scripts/check-tauri-contracts.mjs`.

## Fix

Run:

```bash
pnpm generate:contracts
```

Then update wrapper normalization and tests as needed.

Do not edit `src/generated/tauri-contracts.ts` manually.

