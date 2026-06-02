# Frontend Quality

## Validation Order

After frontend changes, run the narrowest applicable checks first:

1. Targeted Vitest file for changed component/hook/lib behavior.
2. `pnpm test` for broader frontend coverage when shared behavior changed.
3. `pnpm typecheck` when contracts or shared TS types changed.
4. `pnpm e2e` for browser-level workflows, drag/floating layout, app boot, or publish flow smoke.

## Current Test Styles

- Components: `src/components/**/__tests__/*.test.tsx`
- Hooks: `src/hooks/__tests__/*.test.ts`
- Libraries/features: `src/lib/__tests__/*.test.ts`, feature-local `__tests__`
- E2E: `tests/e2e/specs/*.spec.ts`
- Tauri browser mocking for e2e: `tests/e2e/fixtures/mock-tauri.ts`

## Quality Rules

- Keep command calls centralized behind wrappers.
- Keep form controls controlled and accessible.
- Keep store updates synchronized with backend authoritative state.
- Use generated contracts for Tauri payloads.
- Do not add unsupported desktop-runtime, Node, or browser-only APIs to renderer code without checking current Tauri support and existing examples.
