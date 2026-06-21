# 使用 Geist 设计系统优化全页面

## Goal

Use `DESIGN.md` and `design.dark.md` as the source of truth to bring the One Publish renderer into a consistent Geist design system across the whole app surface.

This task starts with a throwaway UI prototype pass because the user explicitly invoked the `prototype` skill. The prototype answers the visual direction question before production changes are absorbed.

## User Value

- The app should feel like one coherent tool instead of a collection of locally tuned panels.
- Light and dark themes should use the same semantic token vocabulary and remain readable.
- Dense work surfaces should stay efficient for repeated publishing workflows.
- The user should be able to compare design directions before the production UI is broadly changed.

## Confirmed Facts

- This is a React 18 + TypeScript + Vite + Tailwind renderer inside a Tauri app.
- The app is effectively a single-page, three-column workbench with many modal/dialog surfaces, not a multi-route website.
- Main surfaces include:
  - App shell and loading state.
  - Repository list / branch worktree panels.
  - Publish configuration panel.
  - Main publish content area: execution, diagnostics, history/home views.
  - Settings, environment check, edit repository, configuration, quick-create profile, command import, rerun checklist, release checklist, and related dialogs.
- `DESIGN.md` and `design.dark.md` define the Geist token system:
  - 4px spacing scale.
  - Tight radii: 6px controls, 12px menus/dialogs, 16px fullscreen surfaces.
  - Geist typography tokens instead of ad hoc text sizes.
  - Gray/gray-alpha scales for neutral hierarchy and borders.
  - Accent colors for state and primary action only.
  - Two-layer focus ring.
  - Minimal shadows; hierarchy comes from surfaces and borders first.
- The `prototype` skill routes this request to the UI branch:
  - Prefer existing route hosting.
  - Use `?variant=` URL search parameter.
  - Provide 3 structurally different variants.
  - Keep prototype code throwaway and later delete or absorb the winning direction.
- The worktree is already dirty with broad Geist-related edits. This task must avoid reverting unrelated user-owned changes.

## Requirements

1. Create a throwaway UI prototype on the existing app surface.
   - It must be clearly marked as prototype-only.
   - It must be switchable via `?variant=`.
   - It must include a floating bottom variant switcher hidden from production builds.
   - It must produce 3 structurally different variants, not color-only tweaks.
   - It must use current app data/state where practical and avoid real mutations from prototype-only controls.

2. Use `DESIGN.md` and `design.dark.md` as the design contract.
   - Map tokens into existing Tailwind/CSS variables rather than hard-coding raw colors in components.
   - Preserve light/dark parity.
   - Use typography tokens (`text-label-*`, `text-copy-*`, `text-heading-*`, `text-button-*`) consistently.
   - Keep radius and spacing within the Geist rules.
   - Avoid decorative motion, heavy shadows, and one-off component vocabulary.

3. Absorb the selected direction into production UI after review.
   - Remove losing prototype variants and the prototype switcher.
   - Fold the selected structure into real components with production-quality code.
   - Keep existing workflows and data behavior intact.

4. Optimize all app surfaces in scoped passes.
   - App shell and three-column layout.
   - Repository/branch/config side panels.
   - Main publish execution, diagnostics, home/history content.
   - Dialog surfaces and form-heavy flows.
   - Shared primitives and token utilities when repeated drift is found.

5. Keep the app accessible and testable.
   - Native controls or local UI primitives.
   - Queryable labels and roles.
   - Visible focus states in both themes.
   - No text overflow in buttons, badges, panels, or dialogs.

## Acceptance Criteria

- [ ] A prototype exists on the existing app route and can switch between variants with `?variant=`.
- [ ] The prototype exposes enough state/content to evaluate the workbench density, side panels, main content, and representative dialog surfaces.
- [ ] The production implementation uses the selected direction and no prototype-only variant code remains.
- [ ] Light and dark themes both follow the `DESIGN.md` / `design.dark.md` token rules.
- [ ] Shared UI primitives are used where available; no parallel button/input/dialog vocabulary is introduced.
- [ ] Key surfaces use Geist typography tokens instead of ad hoc `text-sm`, `text-xs`, or arbitrary font sizes where this task touches them.
- [ ] Focus, hover, active, disabled, loading, error, success, and empty states remain clear after the redesign.
- [ ] Existing publishing, repository, settings, and dialog workflows remain functionally unchanged.
- [ ] Targeted component tests pass for changed components.
- [ ] `pnpm typecheck` passes.
- [ ] React Doctor is run for changed React code; unrelated pre-existing warnings are documented rather than mixed into this task.
- [ ] At least one browser-level smoke check validates the app boots and the main workbench renders in light and dark mode.

## Out of Scope

- Changing Tauri command contracts, Rust backend behavior, or publish execution semantics.
- Rebuilding state management, app boot, or repository/publish domain logic.
- Introducing a new component library or replacing Tailwind.
- Shipping prototype variant switchers to production.
- Solving unrelated existing React Doctor warnings unless a touched file creates a high-confidence regression.

## Decisions

- 2026-06-21: User approved the recommended parent/child split.
- First child task: `.trellis/tasks/06-21-geist-ui-prototype`.
- 2026-06-21: User chose to continue with the normal app prototype direction, interpreted as `A - Dense Workbench` / existing three-column workbench as the production baseline.
- Second child task: `.trellis/tasks/06-21-geist-workbench-normal-absorption`.
