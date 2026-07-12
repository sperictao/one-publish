# Awwwards-level Geist workbench redesign implementation plan

## Plan

1. Audit current production shell and prototype references.
   - Verify: identify exact components to change and preserve user-owned `PublishRunCard.tsx` diff.

2. Upgrade global surface utilities in `src/index.css`.
   - Add production-safe ambient background, panel chrome, stronger list row affordances, and reduced-motion-safe transitions using existing Geist variables.
   - Verify: CSS uses existing tokens and no new dependency.

3. Redesign the production shell.
   - Update `App.tsx`, `SidebarPanelShell`, `MainContentShell`, and topbar styles so the app reads as one coherent workbench frame.
   - Verify: Tauri drag regions and collapsed-panel behavior remain intact.

4. Redesign repository and config panels.
   - Add richer headers, consistent action buttons, refined filters/search, tactile row states, and better empty/loading states.
   - Verify: drag reorder refs, `data-list-*`, `data-testid`, menu behavior, and selection callbacks remain unchanged.

5. Improve right-panel composition.
   - Add a context layer and stronger content rhythm around publish/history content, while preserving existing publish actions and diagnostics.
   - Verify: no blank state when no publish card is active; history view still gates diagnostics as before.

6. All-pages Geist alignment audit (scope expansion, 2026-07-02).
   - Derive a concrete checklist from `DESIGN.md` / `design.dark.md`: token-only colors, typography tokens, radius family (6px controls / 12px modals), 4px spacing rhythm, two-layer focus ring, motion easing/durations, Voice & Content rules.
   - Audit shared primitives first (`src/components/ui/*`, `app-dialog-shell`, `dialog`, `button`, `input`, `select`, `switch`, `sonner`), then each surface: loading page, ProviderRuntimeBanner, and all dialogs (Settings, Shortcuts, EditRepository, ConfigDialog, CommandImport, QuickCreateProfile, ProjectPublishProfileViewer, RerunChecklist, ReleaseChecklist, EnvironmentCheck).
   - Fix deviations in batches: primitives → layout dialogs → publish dialogs → misc; keep interaction logic untouched.
   - Verify per batch: targeted vitest for touched components, no new hardcoded colors outside tokens.

7. Run validation.
   - Targeted tests for changed components where available.
   - Static/type checks.
   - Diff whitespace check.
   - Browser smoke screenshot if the dev server can be started.

8. Final review.
   - Scan diff for unrelated refactors, duplicated logic, hidden fallbacks, accessibility regressions, and user-owned edit damage.

## Validation Commands

- `./node_modules/.bin/vitest run src/components/layout/__tests__/RepositoryList.test.tsx src/components/layout/__tests__/PublishConfigPanel.test.tsx`
- `./node_modules/.bin/tsc --noEmit`
- `git diff --check`
- `./node_modules/.bin/vite --host 127.0.0.1 --port <free-port>` for browser smoke if possible

## Risk Points

- `PublishConfigPanel.tsx` is large and already has React Doctor structural warnings; avoid logic refactors while changing markup/classes.
- `PublishRunCard.tsx` has user-owned edits; preserve or intentionally integrate, never revert.
- `pnpm dev:renderer` can trigger pnpm dependency cleanup prompts in this environment; prefer direct local binaries for validation when possible.
- Port binding may require escalation in this sandbox.
