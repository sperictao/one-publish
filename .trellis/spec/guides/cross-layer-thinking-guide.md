# Cross-Layer Thinking Guide

Use this when a feature crosses React UI, frontend state, Tauri command wrappers, Rust backend code, generated contracts, filesystem/process behavior, or emitted events.

## Current Layer Model

```
React component/dialog
  -> hook or Zustand slice
  -> TypeScript command wrapper
  -> Tauri invoke/event boundary
  -> Rust command/store module
  -> filesystem, process, provider, updater, tray, or store runtime
```

Generated contracts connect Rust payload types to TypeScript through:

```
Rust type -> src-tauri/src/contracts.rs -> src/generated/tauri-contracts.ts -> wrapper/component types
```

## Planning Questions

Before implementation, answer:

- Which React components or hooks consume the data?
- Which wrapper owns the command call?
- Is there already a Rust command for this behavior?
- Does the payload type cross the generated contract boundary?
- Does the Rust command need path validation, sanitization, capability changes, or publish preflight?
- Does the frontend need only UX validation, or is backend validation missing?
- Which tests prove the flow: Rust unit/integration, Vitest, typecheck/contracts, or Playwright?

## Common Flows

### Read Flow

```
Rust store/command -> generated payload -> TS wrapper normalization -> Zustand/hook -> component
```

Examples:

- `get_app_state` -> `getAppState()` -> `useAppStore.loadState()`
- `list_providers` -> `listProviders()` -> provider hooks/UI

### Write Flow

```
Component action -> hook/slice callback -> TS wrapper -> Rust command validation -> store/filesystem/process side effect -> authoritative result
```

Examples:

- Profile save/update/delete through `src/lib/store/api.ts` and store commands.
- Publish execution through `src/features/publish/publishRuntime.ts` and `src-tauri/src/commands/publish/`.

### Event Flow

```
Rust emits event -> frontend listener/hook consumes event -> UI updates stream/status
```

Example:

- `provider-publish-log` event emitted by `src-tauri/src/commands/publish/logs.rs`.

## Boundary Rules

- Do not duplicate backend validation in React as a second source of truth.
- Do not hand-write TypeScript copies of Rust payloads.
- Do not add direct component-level `invoke` calls when a domain wrapper should own the command.
- Do not update local optimistic state without a path back to backend authoritative state.

## Verification

Pick checks by boundary:

- Rust behavior: `cargo test --manifest-path src-tauri/Cargo.toml`
- Contract boundary: `pnpm check:contracts` or `pnpm typecheck`
- Wrapper/component behavior: `pnpm test`
- Full UI workflow: `pnpm e2e`

