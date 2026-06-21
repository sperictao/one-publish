# Technical Design

## Prototype Branch

Use the `prototype` skill UI branch, sub-shape A: adjustment to an existing page.

The existing app route already contains the workbench, current data, and all relevant density. A standalone prototype route would make the variants easier to flatter and less useful.

## Integration Point

Preferred integration point:

- `src/App.tsx` decides whether prototype mode is active from `window.location.search`.
- Normal app rendering remains the default when no supported `variant` query exists.
- Prototype rendering should reuse the current boot object from `useAppBoot()`.

Potential files:

- `src/components/prototype/GeistWorkbenchPrototype.tsx`
- `src/components/prototype/PrototypeVariantSwitcher.tsx`

The `prototype` folder name makes the throwaway nature explicit.

## Variant Data Contract

Each variant receives a compact app context object derived from existing boot data:

- repositories and selected repository summary,
- publish configuration summary,
- active publish command/status summary,
- provider/runtime banner state,
- translated labels where available,
- handlers only for safe existing navigation/state changes.

Avoid passing mutation handlers into prototype-only controls unless they already exist as normal visible app actions.

## Variant Structure

### Variant A - Dense Workbench

Intent:

- Low-risk refinement of current three-column layout.
- Keep repository/config/publish areas in their familiar order.
- Focus on token fidelity, tighter state rows, and better empty/loading surfaces.

Structure:

- Left navigation panel.
- Middle configuration panel.
- Right publish surface.
- Stronger current selection header.

### Variant B - Inspector Focus

Intent:

- Make the right side feel like the primary inspection/execution workspace.
- Reduce side panel visual weight.

Structure:

- Compact two side rails.
- Main surface has a top context strip, readiness/status region, and output/diagnostics stack.
- Better for publish/debug workflows.

### Variant C - Command Center

Intent:

- Put current repo/config/publish readiness at the top of the mental model.
- Use side panels as supporting selectors.

Structure:

- Top command/context band across the workbench.
- Below it, selector columns and publish content are visually grouped.
- Useful if the current UI feels too list-first.

## Switcher Behavior

The switcher:

- Renders only when `import.meta.env.PROD` is false.
- Reads the current variant from URL search params.
- Writes the next variant with `window.history.replaceState`.
- Dispatches a `popstate` or local state update so React re-renders.
- Does not intercept arrow keys when `event.target` is:
  - `input`,
  - `textarea`,
  - `select`,
  - `[contenteditable]`.

## Styling Rules

- Use Tailwind tokens already mapped from `DESIGN.md` / `design.dark.md`.
- Prefer existing local primitives where useful, but variants can use lightweight markup because this is throwaway code.
- Do not hard-code raw hex colors.
- Use `text-label-*`, `text-copy-*`, `text-heading-*`, and `text-button-*`.
- Keep surfaces within Geist radii:
  - `rounded-sm` controls,
  - `rounded-md` menus/panels,
  - `rounded-lg` only for large shells if needed.

## Production Safety

- Normal app path must remain unchanged when no variant query is present.
- Prototype switcher must be absent in production builds.
- No backend or Tauri invocation changes.
- No fake persistence.

## Cleanup Path

When the user chooses a direction:

- Record the chosen variant and rationale in the parent task or next child task.
- Delete losing variants and the switcher.
- Rebuild the chosen direction in production components under normal quality rules.
