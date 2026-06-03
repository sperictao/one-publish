# Auto-select project file when adding repositories

## Goal

When a supported .NET repository is added, One Publish should automatically populate the repository `projectFile` field with the most accurate project file the backend can recommend. The value must be visible immediately in the repository editor and usable by publish/profile flows without requiring the user to re-open settings and choose the project manually.

## Requirements

- The add-repository flow must preserve the backend recommended project file from scan through persisted app state and frontend normalized state.
- For .NET repositories, project recommendation remains backend-owned. The frontend may decide whether to request candidate scanning, but it must not infer the selected project from "only one candidate" or duplicate Visual Studio project ranking rules.
- The recommendation logic must continue to follow Visual Studio-style signals already modeled in the backend, including `.slnLaunch` start projects, `.sln` membership, repository/solution/project name matching, and de-prioritizing test-like projects.
- When a single `.sln` lists multiple non-test projects and no `.slnLaunch` exists, the backend should use the solution's project order as the Visual Studio-style tie breaker instead of returning no recommendation.
- Worktree handling must remain correct: nested linked worktrees must not contribute project candidates even when the worktree has a `.git` file rather than a `.git` directory.
- The fix must account for real Tauri command payload contracts, not only mocked TypeScript wrapper behavior.
- Existing unrelated UI/i18n dirty changes in the worktree must not be reverted or refactored as part of this task.

## Acceptance Criteria

- [ ] Adding a .NET repo whose scan result includes `recommendedProjectFile` persists a repository with `projectFile` set to that value.
- [ ] The frontend wrapper sends the selected repository path to `scan_project_candidates` using the payload shape expected by the Tauri command.
- [ ] A regression test fails before the fix for the real boundary that drops or misses `projectFile`, then passes after the fix.
- [ ] Existing tests covering .NET project recommendation and nested worktree exclusion still pass.
- [ ] The implementation is not a patch-on-patch: there is one clear source of truth for project recommendation and no frontend duplicate ranking fallback.

## Notes

- User retested after the first fix and confirmed newly added repositories still do not auto-fill the project file field.
- The initial payload-key suspicion was checked against local Tauri macro source. `#[tauri::command]` defaults argument keys to camelCase, so Rust `start_path` expects JS `startPath`; the existing wrapper key is correct.
- The reproduced root cause is backend recommendation ambiguity: a linked worktree root with one solution and multiple non-test projects returned `recommendedProjectFile = None`, so the frontend correctly persisted no project file.
