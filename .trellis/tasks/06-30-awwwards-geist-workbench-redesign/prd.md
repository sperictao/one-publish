# Awwwards-level Geist workbench redesign

## Goal

Redesign the main One Publish workbench so it reaches a high-end creative product feel comparable to strong Awwwards-style interfaces while still behaving like a focused desktop productivity app. The result should use `DESIGN.md` and `design.dark.md` as the source of truth for Geist tokens, typography, surface rhythm, and light/dark theme behavior.

The redesign must make the current three-pane app feel intentional and visually rich, not like separate generic cards placed side-by-side.

## Confirmed Facts

- The renderer stack is React 18, TypeScript, Vite, Tailwind v3, Radix primitives, local shadcn-style UI components, Zustand, and Tauri wrappers.
- `src/index.css` and `tailwind.config.cjs` already define Geist light/dark tokens from `DESIGN.md` and `design.dark.md`.
- `src/components/prototype/GeistWorkbenchPrototype.tsx` contains a development-only visual prototype that proves a richer Geist workbench direction, but production still uses the functional shell in `src/App.tsx`, `RepositoryList`, `PublishConfigPanel`, `MainContentShell`, and `PublishContentSection`.
- The working tree already has a user-owned edit in `src/components/publish/PublishRunCard.tsx`; preserve it and only touch that file if the redesign scope requires working with the existing change.

## Requirements

- Use Geist tokens from `DESIGN.md` / `design.dark.md` rather than inventing a new palette or adding a new styling framework.
- Keep the app identity unified: developer-tool clarity, dense-but-readable workflows, restrained color, strong hierarchy, and no marketing-page hero layout.
- Increase visual richness with production-safe techniques: ambient surface depth, layered context strips, refined active states, richer empty/loading states, stronger typography rhythm, and more tactile hover/pressed/focus states.
- Preserve existing publish, repository, config, history, dialog, drag-reorder, and Tauri behavior.
- Keep the implementation focused on the production workbench path, not a wholesale rewrite.
- Support both light and dark modes with consistent token usage and no sudden unrelated color systems.
- Avoid hidden fallbacks, mocked success paths, or broad error swallowing.
- Keep accessibility intact: semantic landmarks where practical, keyboard focus rings, readable contrast, and no interaction that depends on color alone.

## Scope Expansion (2026-07-02, user-approved)

The user directed: strictly follow `DESIGN.md` and `design.dark.md` across ALL pages, superseding the earlier "workbench only" boundary. The expansion is an audit-style alignment pass, not a visual rework:

- Coverage: startup loading page, main workbench shell, Provider Runtime banner, toasts, and every lazy-loaded dialog (Settings, Shortcuts, EditRepository, ConfigDialog, CommandImport, QuickCreateProfile, ProjectPublishProfileViewer, RerunChecklist, ReleaseChecklist, EnvironmentCheck) plus the shared `src/components/ui/*` primitives they compose. `docs/software-pages-functions.md` is the page inventory.
- Method: audit each surface against DESIGN.md tokens and rules (color steps, typography tokens, 4px spacing rhythm, radius family, focus ring, motion, voice & content), then fix deviations. Information architecture and interaction behavior stay unchanged.

## Acceptance Criteria

- [ ] Main production workbench has a richer, more intentional shell: unified app frame, stronger visual hierarchy, and coordinated left/middle/right panels.
- [ ] Repository and config panels feel like related instruments inside one app, with consistent headers, controls, rows, badges, hover states, and active states.
- [ ] Right-side publish/history content gains a clear context layer and visual depth without losing current actions or diagnostics.
- [ ] Light and dark themes both render coherently using existing Geist variables.
- [ ] Existing user-owned `PublishRunCard.tsx` changes are preserved unless intentionally integrated.
- [ ] Targeted component tests or existing relevant tests pass for changed component behavior.
- [ ] `pnpm typecheck` or the closest runnable static check passes; if full typecheck is blocked by environment, document the blocker and run the next best checks.
- [ ] A browser smoke check or screenshot review confirms the workbench renders without blank screens, text overlap, or broken layout at desktop size.
- [ ] Every dialog and auxiliary surface listed in the Scope Expansion uses Geist tokens only (no ad-hoc hex/px values outside token scale), correct radius family (6px controls, 12px menus/modals), typography tokens, and the two-layer focus ring in both themes.
- [ ] UI copy on audited surfaces follows DESIGN.md Voice & Content rules within the bounds of the existing i18n system.

## Out Of Scope

- Adding new runtime dependencies, animation libraries, or routing frameworks.
- Reworking backend/Tauri command contracts.
- Replacing the app with a marketing-site style landing page.
- Cleaning unrelated React Doctor findings or unrelated user edits.
- Changing dialog information architecture, form logic, or interaction flows (audit-style visual alignment only).
