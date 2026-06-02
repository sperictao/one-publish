# Rust To TypeScript Contracts

Shared Tauri payload types are generated from Rust with `ts-rs`. Do not hand-edit `src/generated/tauri-contracts.ts`.

## Source Of Truth

- Rust types live in their feature modules, for example `src-tauri/src/spec.rs`, `src-tauri/src/store/types.rs`, and command contract modules.
- `src-tauri/src/contracts.rs` lists the exported types and generates TypeScript declarations.
- `src-tauri/examples/generate_tauri_contracts.rs` writes the generated TS file.
- `src/generated/tauri-contracts.ts` is the committed output consumed by frontend wrappers.

## When Changing Payloads

If a Rust command returns or accepts a new shared type:

1. Derive or implement the traits already used by neighboring exported types.
2. Add the type to `generate_tauri_contracts()` in `src-tauri/src/contracts.rs` when it must cross into TypeScript.
3. Run `pnpm check:contracts` or `pnpm generate:contracts`.
4. Update frontend wrappers/types to use the generated contract.
5. Add focused tests for the behavior that changed.

## Existing Drift Check

`scripts/check-tauri-contracts.mjs` runs the Rust generator and fails if `src/generated/tauri-contracts.ts` changes. `pnpm typecheck` runs this check before `tsc --noEmit`.

Reference files:

- `src-tauri/src/contracts.rs`
- `src-tauri/examples/generate_tauri_contracts.rs`
- `scripts/check-tauri-contracts.mjs`
- `src/generated/tauri-contracts.ts`

