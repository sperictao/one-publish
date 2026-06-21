# Technical Design

## Direction

Selected direction: `A - Dense Workbench`.

The production implementation should preserve the existing real three-column workbench and apply Geist refinements incrementally. Prototype components are reference material, not production code to copy wholesale.

## First Slice Boundaries

This child task focuses on:

- `src/App.tsx`
- `src/components/prototype/GeistWorkbenchPrototype.tsx`
- `src/components/prototype/geistPrototypeVariant.ts`
- `src/components/layout/MainContentShell.tsx`
- `src/components/layout/PublishContentSection.tsx`
- `src/components/layout/SidebarPanelShell.tsx`
- `src/components/layout/RepositoryList.tsx`
- `src/components/layout/PublishConfigPanel.tsx`

It should avoid broad edits to:

- repository row behavior,
- publish config list ordering/drag behavior,
- publish execution logic,
- dialogs.

## Production Path

Default `/`:

- Uses the real `RepositoryList`, `PublishConfigPanel`, `MainContentShell`, and `PublishContentSection`.
- Keeps all handlers and app boot state unchanged.
- Receives only layout/surface/spacing refinements.

Prototype path:

- `?variant=A` remains development-only during this transition.
- B/C variants and the switcher are removed after the A direction is selected.
- It is used for visual comparison only.

## Design Changes To Consider

1. App shell
   - Use the same dense 8px outer rhythm as prototype A.
   - Keep panels visually grouped as production surfaces.
   - Avoid additional decorative wrappers.

2. Main content shell
   - Match Geist radius/surface rules.
   - Keep header compact and readable.
   - Keep list-scroll shell as the content scroll boundary.

3. Publish content section
   - Reduce over-large gaps where production diverges from dense workbench.
   - Keep command/status/output vertical flow.
   - Preserve `PublishRunCard` props and behavior.

4. Repository/config sidebars
   - Align panel radius and clipping with the selected dense workbench.
   - Keep the search shell as the single visible input frame.
   - Keep list ordering, drag/drop, selection, and action handlers unchanged.

## Compatibility

- No prop contract changes unless TypeScript forces a narrow, local change.
- No backend calls.
- No persistence changes.
- Existing E2E selectors should continue to work.

## Rollback

Revert only the touched production layout files and prototype cleanup files for this child. Do not roll back unrelated Geist changes already present in the worktree.
