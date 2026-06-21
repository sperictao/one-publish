# Implementation Plan

## Phase 0 - Planning Gate

- [x] Review `prd.md`, `design.md`, and this `implement.md` with the user.
- [x] Decide whether this parent task should create child tasks.
- [ ] Do not run `task.py start` until the user approves implementation.

## Phase 1 - Prototype Direction

- [x] Create a child task for the UI prototype if the user accepts the recommended parent/child split.
- [ ] Read Phase 2 context through `trellis-before-dev` before editing.
- [ ] Add a prototype switcher hidden from production builds.
- [ ] Add 3 variants on the existing app route using `?variant=`.
- [ ] Keep variants close to app shell/layout code and clearly marked as throwaway.
- [ ] Include enough real content/state to judge:
  - workbench density,
  - side panel hierarchy,
  - publish execution area,
  - representative dialog/form surface.
- [ ] Start the renderer and provide URLs for `?variant=A`, `?variant=B`, `?variant=C`.

## Phase 2 - Production Absorption

- [ ] User selects a direction or hybrid.
- [ ] Delete losing variants and prototype switcher.
- [ ] Absorb selected direction into production components.
- [ ] Start with shared primitives/tokens only if repeated drift is confirmed.
- [ ] Then update app shell and panels.
- [ ] Then update publish content surfaces.
- [ ] Then update dialogs/form-heavy surfaces.
- [ ] Keep each child task independently verifiable.

## Phase 3 - Verification

Run checks in this order for each production child task:

1. Targeted Vitest tests for changed components.
2. `pnpm typecheck`.
3. `npx react-doctor@latest --verbose --scope changed`.
4. Targeted Playwright smoke for app boot and relevant workflow.
5. Manual/browser screenshot review for light and dark modes where feasible.
6. `git diff --check`.

Known caveat:

- Existing React Doctor findings in unrelated dirty files should be documented, not fixed in unrelated slices.

## Risk Controls

- Before every implementation slice, run `git status --short` and list recognized vs unrelated dirty files.
- Keep prototype code out of production builds.
- Do not mix backend behavior changes with design-system work.
- Keep text from overflowing buttons, badges, side panels, and dialogs.
- Verify dark mode after token or surface changes.

## Suggested Child Tasks

1. `geist-ui-prototype`
   - Build the throwaway `?variant=` prototype and get user selection.

2. `geist-shared-primitives`
   - Align `Button`, `Input`, `Dialog`, `Card`, `Select`, `Tooltip`, and CSS surface helpers with the selected direction and Geist docs.

3. `geist-workbench-panels`
   - Apply production layout to app shell, repository/branch panels, and publish config panel.

4. `geist-publish-content`
   - Apply production layout to publish execution, diagnostics, history/home, and artifact actions.

5. `geist-dialogs-forms`
   - Apply production layout to settings, environment, edit repo, config, quick-create, import, rerun, and release checklist dialogs.

6. `geist-final-verification`
   - Cross-theme screenshot/smoke pass, cleanup prototype leftovers, final React Doctor/typecheck/diff check.
