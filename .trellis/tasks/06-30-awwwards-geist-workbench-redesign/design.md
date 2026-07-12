# Awwwards-level Geist workbench redesign design

## Boundary

This is a production workbench redesign inside the existing React/Tailwind/Tauri app. The implementation should upgrade the visible shell and core workbench components while leaving data ownership, Tauri command wrappers, publish runtime behavior, Zustand store shape, and Rust code unchanged.

Primary production files likely in scope:

- `src/App.tsx`
- `src/index.css`
- `src/components/layout/SidebarPanelShell.tsx`
- `src/components/layout/MainContentShell.tsx`
- `src/components/layout/RepositoryList.tsx`
- `src/components/layout/RepositoryRow.tsx`
- `src/components/layout/PublishConfigPanel.tsx`
- `src/components/layout/topbarButtonStyles.ts`
- `src/components/layout/PublishContentSection.tsx`

`src/components/publish/PublishRunCard.tsx` already has user-owned changes. Treat it as a preserve-first file. Touch it only when the right-panel composition cannot be completed without integrating that existing change.

## Visual Direction

Use Geist as the foundation, not as a flat clone. The richer layer should come from composition and micro-interaction:

- One unified app frame with subtle ambient background, not three unrelated floating panels.
- Panel headers that read as instruments: icon, title, count/status, and compact controls.
- A right-panel context strip that gives repository, branch, provider, and active config before publish output.
- List rows that feel tactile through selected-state borders, soft fills, icon wells, status chips, and consistent action affordances.
- Motion limited to meaningful transitions: hover, pressed, panel state, row focus, and loading. Use transform/opacity/color, not layout-moving animation.
- Light/dark parity through existing variables. Dark mode can use off-black depth, but should not introduce a separate palette.

## Architecture

Keep the redesign mostly presentational:

- Add small, local presentational helpers only where they reduce repeated markup in the same component.
- Prefer CSS utility classes and existing `cn` merging over new component abstraction.
- Use local UI primitives (`Button`, `Input`, `DropdownMenu`, `Card` where a card is still semantically useful).
- Do not move business logic out of hooks or stores.
- Do not introduce remote assets; this is a desktop productivity app and should not depend on network imagery.

The development-only prototype can be used as a reference for composition, but production should keep real components and live data. Do not route normal users through `GeistWorkbenchPrototype`.

## Interaction And Accessibility

- All new clickable controls use native `button` or existing primitives.
- Preserve `data-tauri-drag-region` / `data-tauri-no-drag` behavior for draggable titlebar regions.
- Keep drag-reorder list attributes and refs intact.
- Add visible focus states wherever new interaction classes are introduced.
- Preserve testing hooks such as `list-scroll-shell`, existing `data-testid`, and row `data-list-*` attributes.

## Validation Strategy

Run checks in this order after implementation:

1. Targeted component tests for changed layout/list/publish components when available.
2. `pnpm typecheck` if available; otherwise direct `./node_modules/.bin/tsc --noEmit` plus contract check if not blocked.
3. `git diff --check`.
4. Browser smoke screenshot at desktop size using an existing or direct Vite server.

If Vite cannot bind a port in the sandbox, retry with approved escalation or use the existing running port if available.

## Rollback

The rollback boundary is the production renderer UI files listed above plus the Trellis task files. Since the task avoids store and backend changes, rollback should not require data migration or contract regeneration.
