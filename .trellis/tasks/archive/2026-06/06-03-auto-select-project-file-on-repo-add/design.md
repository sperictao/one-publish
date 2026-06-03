# Design

## Data Flow

1. User clicks Add Repository in `RepositoryList`.
2. `handleAddRepoRuntime` opens the directory picker and receives the selected repo path.
3. The runtime calls `detectRepositoryProvider(path)`.
4. If the provider requires project binding, the runtime calls `scanProjectCandidates(path)`.
5. Rust `scan_project_candidates(start_path)` scans the selected path and returns `ProjectScanCandidates.recommendedProjectFile`.
6. The runtime creates a `Repository` with `projectFile` set to that recommendation and calls `addRepository`.
7. The store persists the repository and returns normalized app state to Zustand.

## Source Of Truth

Rust remains the source of truth for .NET project recommendation. Frontend code should only:

- decide when a provider requires project candidate scanning,
- pass the selected repository path to the command with the correct Tauri payload key,
- copy `recommendedProjectFile` into the new repository payload.

Frontend code must not duplicate Visual Studio ranking logic or infer project binding from candidate count when the backend did not recommend a project.

## Backend Recommendation

Recommendation priority stays in one backend scoring path:

- `.slnLaunch` start projects have the strongest signal.
- Projects declared by the solution outrank unlisted projects.
- When there is exactly one solution, declaration order becomes the tie breaker, matching the solution's startup-project ordering signal closely enough for repositories without `.slnLaunch`.
- Repository/solution/project name matches and test-like project de-prioritization remain secondary signals.
- Multiple solutions keep membership as a signal but do not use cross-solution declaration order as a tie breaker.

## Boundary Risks

- Tauri command payload keys default to camelCase in the local `tauri-macros` wrapper, so Rust `start_path` maps to JS `startPath` unless the command uses `rename_all = "snake_case"`.
- TypeScript generated contracts use camelCase for the returned `ProjectScanCandidates` fields, so returned scan data should remain consumed as `recommendedProjectFile`.
- `Repository` is generated with camelCase fields (`projectFile`, `providerId`), so frontend state normalization should preserve `projectFile`.
- `add_repository` currently does not validate project binding before adding. The add flow should still set the value before persistence; validation for multi-project save remains in `update_repository`.

## Worktree Handling

No new worktree scanner should be introduced. Existing backend `FileScanContext` excludes nested worktree roots discovered from `git worktree list --porcelain` and direct `.git` entries. Tests for nested worktrees must remain green.

## Rollback

If the backend ordering rule is incorrect, revert only the repository recommendation scoring change and its regression test. Do not revert unrelated UI/i18n changes already present in the worktree.
