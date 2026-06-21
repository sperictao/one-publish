# 正常工作台方向吸收

## Goal

Absorb the selected `A - Dense Workbench` prototype direction into the real default One Publish workbench path without changing publishing behavior.

## Parent Tasks

- Parent: `.trellis/tasks/06-21-geist-all-pages-design-optimization`
- Design direction source: `.trellis/tasks/06-21-geist-ui-prototype/NOTES.md`

## User Value

- The default `/` app should continue to be the real, functional One Publish workbench.
- The UI should move toward the selected Geist dense workbench direction without replacing real components with read-only prototype summaries.
- The first production absorption slice should be easy to review and roll back.

## Requirements

1. Keep default `/` as the real app.
   - Do not render the prototype on `/`.
   - Do not replace functional panels with prototype-only summaries.

2. Absorb the `A - Dense Workbench` direction into production components in a narrow first slice.
   - App shell spacing and surface hierarchy.
   - Main content shell and publish content spacing.
   - Existing three-column structure preserved.

3. Keep only the selected prototype direction available temporarily for comparison.
   - `?variant=A` may remain during this child task.
   - B/C prototype variants and the multi-variant switcher should be removed.
   - Later cleanup can remove the remaining A comparison route after production absorption is complete.

4. Preserve behavior.
   - No Tauri command changes.
   - No store or publish runtime semantic changes.
   - No fake data in production code paths.

5. Follow `DESIGN.md` and `design.dark.md`.
   - Use existing tokens and shared surface classes.
   - Keep typography/radius/spacing within Geist rules.
   - Avoid decorative shadows or unrelated redesign.

## Acceptance Criteria

- [x] `/` renders the normal functional app, not a prototype summary.
- [x] The default workbench shell visually follows the selected dense workbench direction more closely.
- [x] Existing repository/config/publish workflows remain available on `/`.
- [x] `?variant=A` still works during this transition for comparison.
- [x] `?variant=B` and `?variant=C` no longer render prototype variants.
- [x] No backend/Tauri contract or publish behavior changes.
- [x] Targeted E2E smoke passes for normal route and prototype route.
- [x] `pnpm typecheck` passes.
- [x] `npx react-doctor@latest --verbose --scope changed` is run and triaged.
- [x] `git diff --check` passes for touched files.

## Out of Scope

- Full redesign of every dialog.
- Removing the final A comparison route.
- Absorbing B or C layouts.
- Refactoring state management or publish execution.
- Fixing unrelated existing React Doctor warnings.
