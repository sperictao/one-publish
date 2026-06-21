# Technical Design

## Scope Shape

This is a parent-level design-system alignment task for the renderer. The app is a single-page workbench, so "all pages" means all primary surfaces and dialogs reachable from the app shell.

The work should happen in phases:

1. Throwaway prototype phase.
2. Production absorption phase.
3. Verification and cleanup phase.

The prototype phase answers the visual direction. The production phase rewrites the selected direction with normal quality expectations.

## Prototype Strategy

Use the `prototype` skill UI branch, sub-shape A:

- Host variants inside the existing app route rather than creating an isolated fake page.
- Keep current data fetching, boot state, translations, and state ownership.
- Switch rendering by reading `?variant=` from `window.location.search`.
- Add a prototype-only floating switcher component that:
  - Cycles between variants.
  - Updates the URL search param.
  - Supports left/right arrow keys unless focus is inside an input, textarea, or contenteditable element.
  - Is hidden in production builds.

Prototype code must be clearly named with `Prototype` and located near the relevant app shell/layout code.

## Variant Intent

Default to three variants:

1. `A - Dense Workbench`
   - Preserve the current three-column productivity shape.
   - Improve visual consistency, spacing, typography, and state hierarchy.
   - Best for low-risk absorption.

2. `B - Inspector Focus`
   - Side panels remain compact, but the right content area gets stronger section hierarchy.
   - Better for publish execution and diagnostics-heavy workflows.

3. `C - Command Center`
   - Emphasize top-level actions, selected repository/config context, and publish readiness.
   - Useful if the current side panels feel too list-heavy.

Each variant must differ structurally, not just in color.

## Production Absorption Boundaries

After the user picks a direction:

- Delete losing variants.
- Delete or disable the prototype switcher.
- Rebuild the selected direction in production components.
- Consolidate repeated class patterns into existing shared primitives or small local helpers only when duplication is real.

Do not let prototype shortcuts leak into production:

- No fake data in production paths.
- No URL variant gates after absorption.
- No broad try/catch fallback to mask UI runtime failures.

## Design System Mapping

Use existing Tailwind theme tokens and `src/index.css` semantic classes as the integration boundary.

Expected mapping:

- Colors:
  - `background`, `card`, `popover`, `muted`, `border`, `input`, `ring`.
  - `interactive`, `success`, `warning`, `destructive` for states.
  - Gray-alpha tokens for borders, hover states, and overlays.

- Typography:
  - `text-heading-*` for titles.
  - `text-label-*` for labels, nav, badges, metadata.
  - `text-copy-*` for multi-line descriptions.
  - `font-mono` only for commands, paths, and logs.

- Radius:
  - `rounded-sm` for controls and compact cards.
  - `rounded-md` for menus/dialog shells.
  - `rounded-lg` only where a fullscreen or large surface earns it.
  - `rounded-full` only for pills and icon circles.

- Motion:
  - Use existing `duration-150 ease-geist` style for state transitions.
  - Avoid decorative or long-running motion.
  - Keep loading spinners only where they indicate active work.

## Target Surfaces

1. App shell
   - `src/App.tsx`
   - `src/components/layout/MainContentShell.tsx`
   - `src/components/layout/SidebarPanelShell.tsx`
   - `src/components/layout/ResizeHandle.tsx`

2. Left and middle panels
   - `RepositoryList.tsx`
   - `RepositoryRow.tsx`
   - `BranchPanel.tsx`
   - `PublishConfigPanel.tsx`

3. Publish content
   - `PublishContentSection.tsx`
   - `PublishRunCard.tsx`
   - `DiagnosticsSection.tsx`
   - `ExecutionHistoryCard.tsx`
   - `ArtifactActions.tsx`

4. Dialog and form surfaces
   - `SettingsDialog.tsx`
   - `EnvironmentCheckDialog.tsx`
   - `EditRepositoryDialog.tsx`
   - `ConfigDialog.tsx`
   - `QuickCreateProfileDialog.tsx`
   - `CommandImportDialog.tsx`
   - `CommandImportResultCard.tsx`
   - `RerunChecklistDialog.tsx`
   - `ReleaseChecklistDialog.tsx`

5. Shared primitives
   - `src/components/ui/*`
   - `src/index.css`
   - `tailwind.config.cjs`

## Compatibility

- Keep existing component props and behavior stable unless explicitly planned in a child task.
- Preserve Testing Library queryable names and roles.
- Preserve Tauri wrapper boundaries; this task is renderer styling and layout only.
- Keep app state ownership unchanged.

## Rollback

Prototype rollback:

- Delete prototype files/switcher and remove the `?variant=` gate.

Production rollback:

- Revert only files changed by the current child task.
- Do not revert unrelated dirty worktree changes.
- Prefer small child tasks so rollback does not undo the entire design-system pass.

## Risks

- The current worktree already contains broad uncommitted Geist changes. Every implementation slice must separate new work from existing dirty files.
- "All pages" can become unreviewable if shipped as one massive diff. Child tasks are strongly recommended.
- Dark theme regressions are easy to miss without browser-level smoke checks.
- Prototype code can rot if not deleted or absorbed quickly.
