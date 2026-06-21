# Geist UI 原型变体

## Goal

Build a throwaway UI prototype that lets the user compare three structurally different Geist-based directions for the One Publish workbench before broad production redesign work begins.

## Parent Task

Parent: `.trellis/tasks/06-21-geist-all-pages-design-optimization`

This child answers the design direction question only. Production absorption belongs to later child tasks.

## User Value

- The user can compare concrete UI directions in the real app context instead of reviewing abstract notes.
- The prototype uses current workbench data/state, so density and workflow fit are visible.
- Later production work can follow a chosen direction, reducing broad rework risk.

## Requirements

1. Host the prototype on the existing app route.
   - Use `?variant=A`, `?variant=B`, and `?variant=C`.
   - Do not create a standalone fake top-level route unless the app architecture forces it.

2. Provide three structurally different variants:
   - `A - Dense Workbench`: keeps the current three-column productivity shape and tightens hierarchy.
   - `B - Inspector Focus`: emphasizes the main publish/diagnostics area while keeping side panels compact.
   - `C - Command Center`: emphasizes current repository/config context and publish readiness.

3. Add a prototype-only floating switcher.
   - Fixed bottom-center bar.
   - Previous/next controls.
   - Current variant label.
   - Arrow-key cycling unless focus is in an input, textarea, select, or contenteditable element.
   - Updates the URL search param without full reload.
   - Hidden in production builds.

4. Use real app context as much as practical.
   - Keep existing app boot, translations, repository state, publish state, and dialogs.
   - The prototype may swap rendering structure, but must not introduce fake persisted state.
   - Prototype-only controls must not execute real mutations.

5. Follow Geist design sources.
   - `DESIGN.md`
   - `design.dark.md`
   - Existing Tailwind/CSS token mapping in the app.

6. Mark prototype code as throwaway.
   - File names or comments should make it obvious this is prototype-only code.
   - Later production tasks must delete or absorb it.

## Acceptance Criteria

- [ ] `pnpm dev:renderer` can start the prototype in the existing renderer.
- [ ] `/` renders the normal app when no `variant` query is present.
- [ ] `/?variant=A`, `/?variant=B`, and `/?variant=C` each render a distinct design direction.
- [ ] The floating switcher cycles variants and updates the URL.
- [ ] Arrow-left and arrow-right keyboard cycling works outside editable controls.
- [ ] The switcher is not rendered in production builds.
- [ ] Each variant includes enough real workbench context to evaluate side panels, main publish content, and representative action/status areas.
- [ ] Light and dark mode both remain readable and use Geist tokens.
- [ ] No Tauri/backend command contracts or publish execution behavior are changed.
- [ ] `pnpm typecheck` passes.
- [ ] `npx react-doctor@latest --verbose --scope changed` is run and findings are triaged.
- [ ] `git diff --check` passes for files touched by this child task.

## Out of Scope

- Folding a variant into production.
- Redesigning every dialog in production-quality code.
- Fixing unrelated existing React Doctor warnings.
- Changing persistence, store semantics, Tauri command wrappers, or Rust code.

## One Command To Run

```bash
pnpm dev:renderer
```

Then open:

- `http://localhost:5173/?variant=A`
- `http://localhost:5173/?variant=B`
- `http://localhost:5173/?variant=C`
