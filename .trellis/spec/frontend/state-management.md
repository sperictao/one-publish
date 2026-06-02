# Frontend State Management

The current app uses Zustand, not a query-cache library or an authentication context.

## Store Shape

`src/stores/appStore.ts` composes a root `AppStore` from focused slices:

- `repositorySlice`
- `uiStateSlice`
- `preferenceSlice`
- `publishStateSlice`
- `favoritesSlice`

The root store owns lifecycle fields such as `isLoading`, `error`, and `executionHistory`.

## Loading Authoritative State

`loadState` calls `getAppState()` from `src/lib/store/api.ts`, migrates legacy favorites if needed, and writes the authoritative backend state into Zustand.

When persistence fails in slice actions, use the existing restore pattern instead of leaving optimistic local state as a second source of truth. See `src/stores/appStoreHelpers.ts`.

## Compatibility Hook

`src/hooks/useAppState.ts` wraps the Zustand store and exposes the older app-state interface. It derives the current publish config from `repositories` and `selectedRepoId` with `useMemo`.

When changing store shape:

- Update Rust store types and generated Tauri contracts if the persisted/backend shape changes.
- Update `src/lib/store/types.ts` normalization when Rust and frontend shapes differ.
- Update Zustand slices and compatibility hook together.
- Add focused tests under `src/stores/__tests__/` or `src/hooks/__tests__/`.

## Avoid

- Do not add parallel global state for data already owned by `useAppStore`.
- Do not silently keep optimistic state after backend persistence fails.
- Do not introduce authentication/session state unless the backend gains a real authentication model.
