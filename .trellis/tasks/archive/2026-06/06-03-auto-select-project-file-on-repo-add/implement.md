# Implementation Plan

## Checklist

1. Confirm Tauri command argument naming before changing wrappers. Local `tauri-macros` defaults command argument keys to camelCase, so `startPath` is the correct wrapper key for Rust `start_path`.
2. Add a backend regression test for a linked worktree root containing one solution with multiple non-test projects where the previous backend recommendation returned `None`.
3. Fix backend .NET recommendation scoring so a single solution's project declaration order breaks ties while `.slnLaunch` remains the strongest signal.
4. Keep the add-repository runtime scan trigger fix for provider catalogs that have not loaded yet.
5. Add a wrapper-level regression test proving `scanProjectCandidates("/repo")` still invokes `scan_project_candidates` with `{ startPath: "/repo" }` and normalizes nullable `recommendedProjectFile`.
6. Re-run wrapper tests and existing add-repository runtime tests.
7. Run backend repository tests to keep .NET recommendation and worktree behavior intact.
8. Run typecheck and scoped diff checks.
9. Review the final diff for duplicate recommendation logic, hidden fallbacks, and unrelated edits.

## Validation Commands

```bash
pnpm exec vitest run src/lib/__tests__/storeApi.test.ts src/hooks/__tests__/useRepositoryActions.runtime.test.ts src/components/layout/__tests__/editRepositoryProjectBinding.test.ts
pnpm typecheck
cargo test --manifest-path src-tauri/Cargo.toml commands::repository -- --nocapture
git diff --check -- src-tauri/src/commands/repository/project.rs src-tauri/src/commands/repository/mod.rs src/lib/store/api.ts src/lib/__tests__/storeApi.test.ts src/features/repository/useRepositoryActions.runtime.ts src/hooks/__tests__/useRepositoryActions.runtime.test.ts
```

## Risks

- There are existing unrelated dirty files in UI/i18n code. Keep this task scoped to repository scan/add flow and tests.
- If real user repositories still produce no `recommendedProjectFile`, add another backend fixture based on that repo shape rather than adding frontend fallback selection.
