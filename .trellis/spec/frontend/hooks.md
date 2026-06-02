# Hook Guidelines

Hooks in this repo compose Tauri wrappers, Zustand state, local derived state, and UI-side async flows.

## Existing Hook Families

- App boot/composition: `src/hooks/useAppBoot.ts`, `src/hooks/useShellBoot.ts`, `src/hooks/usePublishBoot.ts`
- App state compatibility: `src/hooks/useAppState.ts`
- Repository flows: `src/features/repository/useRepositoryActions.ts`, `src/features/repository/useRepositoryActions.runtime.ts`
- Publish flows: `src/features/publish/usePublishRunner.ts`, `src/features/publish/usePublishLogStream.ts`
- Provider/config flows: `src/features/provider/`, `src/features/config/`

## Async Pattern

- Keep backend calls in wrapper modules or feature runtime helpers.
- Let hooks orchestrate loading state, derived state, and UI decisions.
- Return explicit callbacks and state for components; avoid components reimplementing command orchestration.
- Use `useCallback`/`useMemo` where existing hooks rely on stable callback identity.

## Error Pattern

Hooks should either:

- Return errors/state for the component to render, or
- Show a toast when the hook owns the user action workflow.

Do not swallow failures just to keep the UI quiet.

## Tests

Hook tests live under `src/hooks/__tests__/` and feature tests under nearby `__tests__` folders. Mock Tauri wrappers or runtime helpers at the boundary, not deep implementation details.

Reference tests:

- `src/hooks/__tests__/useAppState.test.ts`
- `src/hooks/__tests__/usePublishRunner.test.ts`
- `src/hooks/__tests__/useRepositoryActions.runtime.test.ts`

